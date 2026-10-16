import { Dialog, DialogRef } from '@angular/cdk/dialog';
import { DestroyRef, Injectable, inject, type Type } from '@angular/core';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import {
  APP_DIALOG_BACKDROP_CLASS,
  APP_DIALOG_PANEL_CLASS,
} from '../../shared/dialog/dialog-classes';
import type { DataTableMenuItemDef } from '../../shared/components/data-table/data-table.model';
import {
  TRANSACTION_ASSIGN_TITLE_ID,
  TransactionAssignDialogComponent,
} from './assign-dialog/transaction-assign-dialog.component';
import { CATEGORY_PICKER_SEARCH_SELECTOR } from './category-picker/category-picker.component';
import {
  TRANSACTION_EDIT_COMMENT_ID,
  TRANSACTION_EDIT_TITLE_ID,
  TransactionEditDialogComponent,
} from './edit-dialog/transaction-edit-dialog.component';
import type { TransactionDialogData } from './transaction-dialogs.model';
import { TransactionsStore } from './transactions.store';

/**
 * Opens the edit and the assign dialog for a transaction. Provided in the shell next to the
 * {@link TransactionsStore} they save through, so the dialogs close with the shell and at most one
 * of them is open at a time.
 */
@Injectable()
export class TransactionDialogs {
  private readonly dialog = inject(Dialog);
  private readonly store = inject(TransactionsStore);
  private ref: DialogRef<void> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy((): void => this.ref?.close());
  }

  /** The row-menu entries that open the dialogs of `row`: Edit, Assign (with its tooltip). */
  menuItems(row: TransactionRow): readonly DataTableMenuItemDef[] {
    return [
      { nameKey: 'transactions.menuEdit', action: (): void => this.openEdit(row) },
      {
        nameKey: 'transactions.menuAssign',
        tooltipKey: 'transactions.menuAssignTooltip',
        action: (): void => this.openAssign(row),
      },
    ];
  }

  openEdit(row: TransactionRow): void {
    // The comment is the most common edit; the first tabbable would be a button.
    this.open(TransactionEditDialogComponent, row, {
      titleId: TRANSACTION_EDIT_TITLE_ID,
      autoFocus: `#${TRANSACTION_EDIT_COMMENT_ID}`,
    });
  }

  openAssign(row: TransactionRow): void {
    this.open(TransactionAssignDialogComponent, row, {
      titleId: TRANSACTION_ASSIGN_TITLE_ID,
      autoFocus: CATEGORY_PICKER_SEARCH_SELECTOR,
    });
  }

  private open(
    component: Type<unknown>,
    row: TransactionRow,
    { titleId, autoFocus }: { readonly titleId: string; readonly autoFocus: string },
  ): void {
    this.ref?.close();
    const data: TransactionDialogData = { row, store: this.store };
    const ref: DialogRef<void> = this.dialog.open<void, TransactionDialogData>(component, {
      data,
      ariaLabelledBy: titleId,
      panelClass: APP_DIALOG_PANEL_CLASS,
      backdropClass: APP_DIALOG_BACKDROP_CLASS,
      autoFocus,
    });
    this.ref = ref;
    ref.closed.subscribe((): void => {
      if (this.ref === ref) this.ref = null;
    });
  }
}
