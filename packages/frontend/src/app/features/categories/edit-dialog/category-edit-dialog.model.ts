import { HttpErrorResponse } from '@angular/common/http';
import type { Signal } from '@angular/core';
import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type {
  CategoryCycleError,
  CategoryEditableFields,
  CategoryRow,
} from '@hibiscus-frontend/shared/contracts/categories';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import type { Observable } from 'rxjs';

/** A save from the category dialog: a new category, or an edit of a stored one. */
export type CategorySave =
  | { readonly kind: 'create'; readonly fields: CategoryEditableFields }
  | {
      readonly kind: 'update';
      readonly category: CategoryRow;
      readonly next: CategoryEditableFields;
    };

/**
 * What the category dialog reads and saves through: the transactions shell's store or the
 * categories page's store. `saveCategory` answers the row as stored and, on success, has already
 * put it into `categories`.
 */
export interface CategoryEditSource {
  readonly categories: Signal<readonly CategoryRow[]>;
  readonly transactions: Signal<readonly TransactionRow[]>;
  readonly accounts: Signal<readonly AccountRow[]>;
  readonly accountsById: Signal<ReadonlyMap<number, AccountRow>>;
  readonly categoryPathsById: Signal<ReadonlyMap<number, string>>;
  saveCategory(save: CategorySave): Observable<CategoryRow>;
}

/**
 * What `CategoryDialogs` hands to the dialog. The source goes through `DIALOG_DATA`, not the
 * injector: a dialog's injector descends from the root, not from the page that provides the store.
 */
export type CategoryEditDialogData =
  | {
      readonly mode: 'create';
      readonly initial: CategoryEditableFields;
      readonly source: CategoryEditSource;
    }
  | { readonly mode: 'edit'; readonly category: CategoryRow; readonly source: CategoryEditSource };

/** Why a category save failed: changed elsewhere (409), a parent cycle (400), or anything else. */
export type CategorySaveError = 'conflict' | 'cycle' | 'generic';

export function toCategorySaveError(cause: unknown): CategorySaveError {
  if (!(cause instanceof HttpErrorResponse)) return 'generic';
  if (cause.status === 409) return 'conflict';
  const body: Partial<CategoryCycleError> | null =
    cause.error as Partial<CategoryCycleError> | null;
  return cause.status === 400 && body?.error === 'cycle' ? 'cycle' : 'generic';
}

/** A category without its id; listed field by field, so a new column fails to compile here. */
export function editableFieldsOf(category: CategoryRow): CategoryEditableFields {
  return {
    name: category.name,
    nummer: category.nummer,
    pattern: category.pattern,
    isregex: category.isregex,
    umsatztyp: category.umsatztyp,
    parent_id: category.parent_id,
    color: category.color,
    customcolor: category.customcolor,
    kommentar: category.kommentar,
    konto_id: category.konto_id,
    konto_kategorie: category.konto_kategorie,
    flags: category.flags,
  };
}
