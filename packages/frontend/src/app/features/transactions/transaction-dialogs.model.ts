import { HttpErrorResponse } from '@angular/common/http';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import type { TransactionsStore } from './transactions.store';

/**
 * What `TransactionDialogs` hands to a dialog. The store goes through `DIALOG_DATA`, not the
 * injector: a dialog's injector descends from the root, not from the shell that provides the store.
 */
export interface TransactionDialogData {
  readonly row: TransactionRow;
  readonly store: TransactionsStore;
}

/** Why a save failed: the row changed elsewhere (409), or anything else. */
export type SaveError = 'conflict' | 'generic';

export function toSaveError(cause: unknown): SaveError {
  return cause instanceof HttpErrorResponse && cause.status === 409 ? 'conflict' : 'generic';
}
