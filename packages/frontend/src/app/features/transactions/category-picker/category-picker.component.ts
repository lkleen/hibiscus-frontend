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
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Category, CategoryTreeNode } from '../../../core/models/category.model';
import { buildCategoryTree } from '../../../core/utils/category-tree';

interface FlatCategoryOption {
  category: Category;
  depth: number;
}

function flattenTree(nodes: readonly CategoryTreeNode[], depth = 0): FlatCategoryOption[] {
  const result: FlatCategoryOption[] = [];
  for (const node of nodes) {
    result.push({ category: node, depth });
    result.push(...flattenTree(node.children, depth + 1));
  }
  return result;
}

/**
 * Anchored dropdown for picking a transaction's category, built on `@angular/cdk/overlay` +
 * `@angular/cdk/a11y` per frontend-angular-cdk.md (no Angular Material in this repo, so there is
 * no ready-made select/menu component to reach for — this is the "build a small overlay
 * yourself" case that guidance calls out).
 */
@Component({
  selector: 'app-category-picker',
  templateUrl: './category-picker.component.html',
  styleUrl: './category-picker.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [OverlayModule, CdkTrapFocus],
})
export class CategoryPickerComponent {
  private readonly overlay = inject(Overlay);
  private readonly viewContainerRef = inject(ViewContainerRef);
  private readonly destroyRef = inject(DestroyRef);

  readonly categories = input.required<Category[]>();
  readonly selectedCategoryId = input<number | null>(null);
  readonly categoryChange = output<number | null>();

  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly panelTemplate = viewChild.required<TemplateRef<unknown>>('panelTemplate');

  protected readonly isOpen = signal(false);
  protected readonly flatOptions = computed(() =>
    flattenTree(buildCategoryTree(this.categories())),
  );
  protected readonly selectedCategory = computed(
    () => this.categories().find((c) => c.id === this.selectedCategoryId()) ?? null,
  );

  private overlayRef: OverlayRef | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => this.overlayRef?.dispose());
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
        { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
        { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
      ]);

    this.overlayRef = this.overlay.create({
      positionStrategy,
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
      hasBackdrop: true,
      backdropClass: 'cdk-overlay-transparent-backdrop',
      minWidth: triggerEl.nativeElement.offsetWidth,
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

  protected select(categoryId: number | null): void {
    this.categoryChange.emit(categoryId);
    this.close();
    this.trigger().nativeElement.focus();
  }
}
