import { CdkMenu, CdkMenuItem, CdkMenuItemRadio, CdkMenuTrigger } from '@angular/cdk/menu';
import { ConnectedPosition } from '@angular/cdk/overlay';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiService } from '../../services/api.service';
import { SUPPORTED_THEMES, THEME_LABELS, ThemeName } from '../../models/theme.model';
import { ThemeService } from '../../services/theme.service';

/**
 * User identity trigger + menu, built on `@angular/cdk/menu` per frontend-angular-cdk.md (no
 * Angular Material menu to reach for in this repo). The theme identity is a submenu of radio items.
 * The CDK menu stack owns focus, keyboard navigation, Escape/outside-click dismissal and the
 * menuitem* ARIA roles.
 */
@Component({
  selector: 'app-user-menu',
  templateUrl: './user-menu.component.html',
  styleUrl: './user-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CdkMenu, CdkMenuItem, CdkMenuItemRadio, CdkMenuTrigger],
})
export class UserMenuComponent {
  private readonly api = inject(ApiService);
  private readonly themeService = inject(ThemeService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly user = signal<string | null>(null);
  protected readonly loadError = signal(false);

  protected readonly theme = this.themeService.currentTheme;

  protected readonly themeOptions: readonly { name: ThemeName; label: string }[] =
    SUPPORTED_THEMES.map((name) => ({ name, label: THEME_LABELS[name] }));

  protected readonly themeLabel = computed<string>(() => THEME_LABELS[this.theme()]);

  protected readonly ariaLabel = computed<string>(() => {
    const u = this.user();
    if (u) return `User menu, logged in as ${u}`;
    if (this.loadError()) return 'User menu, could not load identity';
    return 'User menu, loading identity';
  });

  /** The trigger sits at the trailing edge of the header, so the menu hangs from its end. */
  protected readonly panelPositions: ConnectedPosition[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
  ];

  /** Same reason: the flyout opens toward the viewport's interior first, then flips. */
  protected readonly submenuPositions: ConnectedPosition[] = [
    {
      originX: 'start',
      originY: 'top',
      overlayX: 'end',
      overlayY: 'top',
      offsetX: -2,
      offsetY: -4,
    },
    { originX: 'end', originY: 'top', overlayX: 'start', overlayY: 'top', offsetX: 2, offsetY: -4 },
  ];

  constructor() {
    this.api
      .getMe()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (me) => this.user.set(me.user),
        error: () => this.loadError.set(true),
      });
  }

  protected setTheme(name: ThemeName): void {
    this.themeService.setTheme(name);
  }
}
