import { CdkTrapFocus } from '@angular/cdk/a11y';
import { ESCAPE } from '@angular/cdk/keycodes';
import { Overlay, OverlayModule, OverlayRef } from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  TemplateRef,
  ViewContainerRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SUPPORTED_THEMES, THEME_LABELS, ThemeName } from '../../models/theme.model';
import { ApiService } from '../../services/api.service';
import { ThemeService } from '../../services/theme.service';

/**
 * User identity trigger + dropdown, built on `@angular/cdk/overlay` + `@angular/cdk/a11y` per
 * frontend-angular-cdk.md — same "build a small overlay yourself" pattern as
 * CategoryPickerComponent (no Angular Material menu to reach for in this repo).
 */
@Component({
  selector: 'app-user-menu',
  templateUrl: './user-menu.component.html',
  styleUrl: './user-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [OverlayModule, CdkTrapFocus],
})
export class UserMenuComponent {
  private readonly api = inject(ApiService);
  private readonly themeService = inject(ThemeService);
  private readonly overlay = inject(Overlay);
  private readonly viewContainerRef = inject(ViewContainerRef);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly user = signal<string | null>(null);
  protected readonly loadError = signal(false);
  protected readonly isOpen = signal(false);

  protected readonly themes = SUPPORTED_THEMES;
  protected readonly themeLabels = THEME_LABELS;
  protected readonly theme = this.themeService.currentTheme;

  protected readonly ariaLabel = computed<string>(() => {
    const u = this.user();
    if (u) return `User menu, logged in as ${u}`;
    if (this.loadError()) return 'User menu, could not load identity';
    return 'User menu, loading identity';
  });

  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly panelTemplate = viewChild.required<TemplateRef<unknown>>('panelTemplate');

  private overlayRef: OverlayRef | null = null;

  constructor() {
    this.api
      .getMe()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (me) => this.user.set(me.user),
        error: () => this.loadError.set(true),
      });

    this.destroyRef.onDestroy(() => this.overlayRef?.dispose());
  }

  protected selectTheme(name: ThemeName): void {
    this.themeService.setTheme(name);
  }

  protected toggle(): void {
    if (this.isOpen()) {
      this.close();
    } else {
      this.openPanel();
    }
  }

  private openPanel(): void {
    const triggerEl = this.trigger();
    const positionStrategy = this.overlay
      .position()
      .flexibleConnectedTo(triggerEl)
      .withPositions([
        { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
        { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
      ]);

    this.overlayRef = this.overlay.create({
      positionStrategy,
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
      hasBackdrop: true,
      backdropClass: 'cdk-overlay-transparent-backdrop',
    });

    this.overlayRef.attach(new TemplatePortal(this.panelTemplate(), this.viewContainerRef));
    this.isOpen.set(true);

    this.overlayRef.backdropClick().subscribe(() => this.close());
    this.overlayRef.keydownEvents().subscribe((event) => {
      if (event.keyCode === ESCAPE) {
        this.close();
        triggerEl.nativeElement.focus();
      }
    });
  }

  private close(): void {
    this.overlayRef?.dispose();
    this.overlayRef = null;
    this.isOpen.set(false);
  }
}
