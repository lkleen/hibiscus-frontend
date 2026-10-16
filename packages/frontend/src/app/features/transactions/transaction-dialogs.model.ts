import { HttpErrorResponse } from '@angular/common/http';
import type {
  TransactionAssignConflict,
  TransactionRow,
} from '@hibiscus-frontend/shared/contracts/transactions';
import type { DataTableMenuItem } from '../../shared/components/data-table/data-table.model';
import type { TransactionsStore } from './transactions.store';

/**
 * What `TransactionDialogs` hands to a dialog. The store goes through `DIALOG_DATA`, not the
 * injector: a dialog's injector descends from the root, not from the shell that provides the store.
 */
export interface TransactionDialogData {
  readonly row: TransactionRow;
  readonly store: TransactionsStore;
}

/**
 * What `TransactionDialogs` hands to the assign dialog: the rows it was opened with (a copy, so a
 * selection that changes meanwhile cannot alter what the dialog saves) and what to do once they
 * are saved.
 */
export interface TransactionAssignDialogData {
  readonly rows: readonly TransactionRow[];
  readonly store: TransactionsStore;
  readonly onAssigned?: () => void;
}

/** What a tab hands to `TransactionDialogs.menuItems` for the right-clicked transaction. */
export interface TransactionMenuParams {
  readonly row: TransactionRow;
  /** The tab's selected transactions; the bulk menu applies when it holds `row` and another one. */
  readonly selectedRows: readonly TransactionRow[];
  /** The "View" entry for `row`; replaced by a disabled one in the bulk menu. */
  readonly view: DataTableMenuItem;
  /** Runs after a bulk assign was saved (the tab clears its selection). */
  readonly onBulkAssigned: () => void;
}

/** Why a save failed: the row changed elsewhere (409), or anything else. */
export type SaveError = 'conflict' | 'generic';

export function toSaveError(cause: unknown): SaveError {
  return cause instanceof HttpErrorResponse && cause.status === 409 ? 'conflict' : 'generic';
}

/** How many rows a `409` reported as changed elsewhere; `null` when the body is not a conflict. */
export function conflictCountOf(cause: unknown): number | null {
  if (!(cause instanceof HttpErrorResponse) || cause.status !== 409) return null;
  const body: Partial<TransactionAssignConflict> | null =
    cause.error as Partial<TransactionAssignConflict> | null;
  return body?.error === 'conflict' && Array.isArray(body.conflictIds)
    ? body.conflictIds.length
    : null;
}
