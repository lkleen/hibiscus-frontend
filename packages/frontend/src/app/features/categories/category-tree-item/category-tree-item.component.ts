import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { Category, CategoryTreeNode, UpdateCategory } from '../../../core/models/category.model';
import { TranslationService } from '../../../core/services/translation.service';

export interface CategoryUpdateEvent {
  id: number;
  changes: UpdateCategory;
}

function collectDescendantIds(node: CategoryTreeNode): Set<number> {
  const ids = new Set<number>();
  for (const child of node.children) {
    ids.add(child.id);
    for (const id of collectDescendantIds(child)) {
      ids.add(id);
    }
  }
  return ids;
}

/** Recursive tree node: renders itself, then its own children via itself. */
@Component({
  selector: 'app-category-tree-item',
  templateUrl: './category-tree-item.component.html',
  styleUrl: './category-tree-item.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CategoryTreeItemComponent],
})
export class CategoryTreeItemComponent {
  protected readonly i18n = inject(TranslationService);

  readonly node = input.required<CategoryTreeNode>();
  readonly allCategories = input.required<Category[]>();
  readonly depth = input(0);

  readonly update = output<CategoryUpdateEvent>();
  readonly addChild = output<number>();
  readonly remove = output<number>();

  protected readonly editing = signal(false);

  // Categories this node could legally be re-parented under: itself and its own descendants are
  // excluded so re-parenting can never create a cycle.
  protected readonly selectableParents = computed(() => {
    const excluded = collectDescendantIds(this.node());
    excluded.add(this.node().id);
    return this.allCategories().filter((c) => !excluded.has(c.id));
  });

  protected readonly parentSelectValue = computed(() => {
    const parentId = this.node().parentId;
    return parentId === null ? '' : parentId.toString();
  });

  protected startEdit(): void {
    this.editing.set(true);
  }

  protected cancelEdit(): void {
    this.editing.set(false);
  }

  protected save(name: string, color: string, parentIdValue: string): void {
    const trimmedName = name.trim();
    if (!trimmedName) {
      return;
    }
    this.update.emit({
      id: this.node().id,
      changes: {
        name: trimmedName,
        color: color || null,
        parentId: parentIdValue ? Number(parentIdValue) : null,
      },
    });
    this.editing.set(false);
  }
}
