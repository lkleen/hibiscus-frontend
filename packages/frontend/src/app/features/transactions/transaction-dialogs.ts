import { Dialog, DialogRef } from '@angular/cdk/dialog';
import { DestroyRef, Injectable, inject, type Type } from '@angular/core';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import {
  APP_DIALOG_BACKDROP_CLASS,
  APP_DIALOG_PANEL_CLASS,
} from '../../shared/dialog/dialog-classes';
import type { DataTableMenuItem } from '../../shared/components/data-table/data-table.model';
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
import type {
  TransactionAssignDialogData,
  TransactionDialogData,
  TransactionMenuParams,
} from './transaction-dialogs.model';
import { TransactionsStore } from './transactions.store';

/**
 * Opens the edit dialog for a transaction and the assign dialog for one or several. Provided in the shell next to the
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

  /**
   * The row-menu entries for `params.row`: View, Edit, Assign. On a row that is part of a
   * multi-row selection, View and Edit are disabled and Assign acts on the whole selection;
   * otherwise they act on the row alone and the selection is left alone.
   */
  menuItems({
    row,
    selectedRows,
    view,
    onBulkAssigned,
  }: TransactionMenuParams): readonly DataTableMenuItem[] {
    const bulk: boolean = selectedRows.length > 1 && selectedRows.some((r) => r.id === row.id);
    if (!bulk) {
      return [
        view,
        { nameKey: 'transactions.menuEdit', action: (): void => this.openEdit(row) },
        {
          nameKey: 'transactions.menuAssign',
          tooltipKey: 'transactions.menuAssignTooltip',
          action: (): void => this.openAssign([row]),
        },
      ];
    }
    return [
      { nameKey: 'table.menuView', action: (): void => undefined, disabled: true },
      { nameKey: 'transactions.menuEdit', action: (): void => undefined, disabled: true },
      {
        nameKey: 'transactions.menuAssign',
        tooltipKey: 'transactions.menuAssignBulkTooltip',
        action: (): void => this.openAssign(selectedRows, onBulkAssigned),
      },
    ];
  }

  openEdit(row: TransactionRow): void {
    // The comment is the most common edit; the first tabbable would be a button.
    const data: TransactionDialogData = { row, store: this.store };
    this.open(TransactionEditDialogComponent, data, {
      titleId: TRANSACTION_EDIT_TITLE_ID,
      autoFocus: `#${TRANSACTION_EDIT_COMMENT_ID}`,
    });
  }

  /** Assigns `rows` (at least one) to a category; `onAssigned` runs once they are saved. */
  openAssign(rows: readonly TransactionRow[], onAssigned?: () => void): void {
    if (rows.length === 0) throw new Error('openAssign needs at least one transaction');
    const data: TransactionAssignDialogData = { rows: [...rows], store: this.store, onAssigned };
    this.open(TransactionAssignDialogComponent, data, {
      titleId: TRANSACTION_ASSIGN_TITLE_ID,
      autoFocus: CATEGORY_PICKER_SEARCH_SELECTOR,
    });
  }

  private open(
    component: Type<unknown>,
    data: TransactionDialogData | TransactionAssignDialogData,
    { titleId, autoFocus }: { readonly titleId: string; readonly autoFocus: string },
  ): void {
    this.ref?.close();
    const ref: DialogRef<void> = this.dialog.open<
      void,
      TransactionDialogData | TransactionAssignDialogData
    >(component, {
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
