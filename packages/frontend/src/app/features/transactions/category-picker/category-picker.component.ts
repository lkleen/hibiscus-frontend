import { ChangeDetectionStrategy, Component, input, model, output } from '@angular/core';
import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import { toCssColor } from '../../../core/utils/category-color';
import { DataTableCellDirective } from '../../../shared/components/data-table/data-table-cell.directive';
import { DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import {
  colDef,
  type DataTableColDef,
  type DataTableOptions,
} from '../../../shared/components/data-table/data-table.model';

/** The search field of the picker; the dialogs focus it when they open. */
export const CATEGORY_PICKER_SEARCH_SELECTOR = 'app-category-picker input[type="search"]';

/**
 * A single-selection category tree with a search field (`<app-data-table>` in tree mode) and a
 * colour swatch per category. `selectedId` is two-way; `picked` fires only for the user's own
 * picks, never for a selection the parent set.
 */
@Component({
  selector: 'app-category-picker',
  templateUrl: './category-picker.component.html',
  styleUrl: './category-picker.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DataTableComponent, DataTableCellDirective],
})
export class CategoryPickerComponent {
  readonly categories = input.required<readonly CategoryRow[]>();
  /** Id of the selected category, `null` for none. */
  readonly selectedId = model<number | null>(null);
  /** Locks the tree (no pointer, no focus) while the parent is busy. */
  readonly disabled = input<boolean>(false);
  /** The category the user just clicked (or chose with Enter/Space). */
  readonly picked = output<number>();

  protected readonly columns: readonly DataTableColDef<CategoryRow>[] = [
    colDef<CategoryRow, string>({
      colId: 'name',
      headerKey: 'categories.colName',
      filter: false,
      cellRenderer: 'categoryName',
      valueGetter: (category: CategoryRow) => category.name,
    }),
  ];

  protected readonly options: DataTableOptions<CategoryRow> = {
    treeData: { getParentId: (category) => category.parent_id, groupColId: 'name' },
    getRowId: (category) => category.id,
    rowSelection: { mode: 'single' },
    defaultSort: [{ colId: 'name', order: 1 }],
    autoSizeStrategy: { type: 'fitGridWidth' },
    scrollHeight: '16rem',
    emptyKey: 'categories.empty',
  };

  protected swatchColor(category: CategoryRow): string | null {
    return toCssColor(category);
  }

  protected onSelectedRowIdChange(id: string | number | null): void {
    // The table only emits ids of selected rows, and a re-click keeps the selection.
    if (id === null) return;
    if (typeof id !== 'number') throw new Error(`category id must be a number, got ${typeof id}`);
    this.selectedId.set(id);
    this.picked.emit(id);
  }
}
