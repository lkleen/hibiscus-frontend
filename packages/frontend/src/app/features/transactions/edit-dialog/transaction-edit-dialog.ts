import { Dialog, DialogRef } from '@angular/cdk/dialog';
import { DestroyRef, Injectable, inject } from '@angular/core';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import {
  APP_DIALOG_BACKDROP_CLASS,
  APP_DIALOG_PANEL_CLASS,
} from '../../../shared/dialog/dialog-classes';
import { TransactionsStore } from '../transactions.store';
import {
  TRANSACTION_EDIT_COMMENT_ID,
  TRANSACTION_EDIT_TITLE_ID,
  TransactionEditDialogComponent,
  type TransactionEditDialogData,
} from './transaction-edit-dialog.component';

/**
 * Opens the edit dialog for a transaction. Provided in the shell next to the
 * {@link TransactionsStore} it saves through, so the dialog closes with the shell and at most one
 * edit dialog is open at a time.
 */
@Injectable()
export class TransactionEditDialog {
  private readonly dialog = inject(Dialog);
  private readonly store = inject(TransactionsStore);
  private ref: DialogRef<void, TransactionEditDialogComponent> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy((): void => this.ref?.close());
  }

  open(row: TransactionRow): void {
    this.ref?.close();
    const data: TransactionEditDialogData = { row, store: this.store };
    const ref: DialogRef<void, TransactionEditDialogComponent> = this.dialog.open<
      void,
      TransactionEditDialogData,
      TransactionEditDialogComponent
    >(TransactionEditDialogComponent, {
      data,
      ariaLabelledBy: TRANSACTION_EDIT_TITLE_ID,
      panelClass: APP_DIALOG_PANEL_CLASS,
      backdropClass: APP_DIALOG_BACKDROP_CLASS,
      // The comment is the most common edit; the first tabbable would be a button.
      autoFocus: `#${TRANSACTION_EDIT_COMMENT_ID}`,
    });
    this.ref = ref;
    ref.closed.subscribe((): void => {
      if (this.ref === ref) this.ref = null;
    });
  }
}
