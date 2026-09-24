import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiService } from '../../core/services/api.service';
import { Category } from '../../core/models/category.model';
import { buildCategoryTree } from '../../core/utils/category-tree';
import {
  CategoryTreeItemComponent,
  CategoryUpdateEvent,
} from './category-tree-item/category-tree-item.component';
import { TranslationService } from '../../core/services/translation.service';

@Component({
  selector: 'app-categories',
  templateUrl: './categories.component.html',
  styleUrl: './categories.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CategoryTreeItemComponent],
})
export class CategoriesComponent {
  private readonly api = inject(ApiService);
  protected readonly i18n = inject(TranslationService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly categories = signal<Category[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);
  protected readonly saveError = signal<string | null>(null);

  protected readonly tree = computed(() => buildCategoryTree(this.categories()));

  // Parent to create the next category under, set by "Add subcategory"; null means a new root
  // category. The create form is always visible, just re-targeted.
  protected readonly newCategoryParentId = signal<number | null>(null);
  protected readonly newCategoryParentValue = computed(() => {
    const parentId = this.newCategoryParentId();
    return parentId === null ? '' : parentId.toString();
  });

  constructor() {
    this.reload();
  }

  private reload(): void {
    this.loading.set(true);
    this.error.set(false);
    this.api
      .getCategories()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (categories) => {
          this.categories.set(categories);
          this.loading.set(false);
        },
        error: () => {
          this.error.set(true);
          this.loading.set(false);
        },
      });
  }

  protected onAddChild(parentId: number): void {
    this.newCategoryParentId.set(parentId);
  }

  protected onCreate(name: string, color: string, parentIdValue: string): void {
    const trimmedName = name.trim();
    if (!trimmedName) {
      return;
    }
    this.saveError.set(null);
    const parentId = parentIdValue ? Number(parentIdValue) : this.newCategoryParentId();
    this.api
      .createCategory({ name: trimmedName, parentId, color: color || null })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.newCategoryParentId.set(null);
          this.reload();
        },
        error: () => this.saveError.set(this.i18n.t('categories.createError')),
      });
  }

  protected onUpdate(event: CategoryUpdateEvent): void {
    this.saveError.set(null);
    this.api
      .updateCategory(event.id, event.changes)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.reload(),
        error: () => this.saveError.set(this.i18n.t('categories.updateError')),
      });
  }

  protected onRemove(id: number): void {
    if (!confirm(this.i18n.t('categories.confirmDelete'))) {
      return;
    }
    this.saveError.set(null);
    this.api
      .deleteCategory(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.reload(),
        error: () => this.saveError.set(this.i18n.t('categories.deleteError')),
      });
  }
}
