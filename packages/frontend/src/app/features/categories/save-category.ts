import type { WritableSignal } from '@angular/core';
import type {
  CategoryRow,
  CategoryUpdateRequest,
} from '@hibiscus-frontend/shared/contracts/categories';
import { Observable, map, tap } from 'rxjs';
import type { ApiService } from '../../core/services/api.service';
import { editableFieldsOf, type CategorySave } from './edit-dialog/category-edit-dialog.model';

/**
 * `CategoryEditSource.saveCategory` for a store holding `categories`. A create appends the row the
 * backend answers; an update replaces the stored row at the same position with the saved values.
 * Neither touches the tax tags: the tag is saved with the category by the backend. Both swap the array rather than mutating it, so everything derived from it recomputes. Errors
 * propagate, and `categories` stays untouched.
 */
export function saveCategoryInto(
  api: ApiService,
  categories: WritableSignal<readonly CategoryRow[]>,
  save: CategorySave,
): Observable<CategoryRow> {
  if (save.kind === 'create') {
    return api.createCategory({ ...save.fields, taxTag: save.taxTag }).pipe(
      tap((row: CategoryRow): void => {
        categories.update((rows: readonly CategoryRow[]) => [...rows, row]);
      }),
    );
  }
  const id: number = save.category.id;
  const request: CategoryUpdateRequest = {
    expected: editableFieldsOf(save.category),
    next: save.next,
    taxTag: save.taxTag,
  };
  return api.updateCategory(id, request).pipe(
    map((): CategoryRow => ({ id, ...save.next })),
    tap((row: CategoryRow): void => {
      categories.update((rows: readonly CategoryRow[]) =>
        rows.map((category: CategoryRow): CategoryRow => (category.id === id ? row : category)),
      );
    }),
  );
}
