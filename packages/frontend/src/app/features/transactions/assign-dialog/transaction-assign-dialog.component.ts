import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import { TranslationService } from '../../../core/services/translation.service';
import { APP_DIALOG_CLASS } from '../../../shared/dialog/dialog-classes';
import { AmountCellComponent } from '../cells/amount-cell/amount-cell.component';
import { CategoryPickerComponent } from '../category-picker/category-picker.component';
import {
  toSaveError,
  type SaveError,
  type TransactionDialogData,
} from '../transaction-dialogs.model';

/** The `ariaLabelledBy` target of the dialog. */
export const TRANSACTION_ASSIGN_TITLE_ID = 'transaction-assign-title';

/**
 * Assigns a transaction to a category: picking one in the tree saves at once ("No category"
 * unassigns), leaving the comment untouched. The save carries the category the dialog started
 * from, so the backend rejects it (409) when the row changed elsewhere in the meantime.
 */
@Component({
  selector: 'app-transaction-assign-dialog',
  templateUrl: './transaction-assign-dialog.component.html',
  styleUrl: './transaction-assign-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: APP_DIALOG_CLASS },
  imports: [CategoryPickerComponent, AmountCellComponent],
})
export class TransactionAssignDialogComponent {
  protected readonly i18n = inject(TranslationService);
  private readonly data: TransactionDialogData = inject<TransactionDialogData>(DIALOG_DATA);
  private readonly dialogRef: DialogRef<void, TransactionAssignDialogComponent> =
    inject<DialogRef<void, TransactionAssignDialogComponent>>(DialogRef);
  private readonly destroyed = signal<boolean>(false);

  protected readonly row: TransactionRow = this.data.row;
  protected readonly titleId: string = TRANSACTION_ASSIGN_TITLE_ID;
  protected readonly categories = this.data.store.categories;

  // The category the dialog started from; "unchanged" is measured against it.
  private readonly initialId: number | null = this.row.umsatztyp_id;

  /** The tree's selection: the current category, or the pick that is being saved. */
  protected readonly selectedId = signal<number | null>(this.initialId);
  protected readonly saving = signal<boolean>(false);
  protected readonly error = signal<SaveError | null>(null);

  /** No pick or "No category" while a save runs, or after the row proved stale. */
  protected readonly locked = computed<boolean>(() => this.saving() || this.error() === 'conflict');

  /** The current category as its path from the root, or "No category". */
  protected readonly categoryLabel = computed<string>(() => {
    if (this.initialId === null) return this.i18n.t('transactions.edit.noCategory');
    return this.data.store.categoryPathsById().get(this.initialId) ?? String(this.initialId);
  });

  protected readonly unassignDisabled = computed<boolean>(
    () => this.locked() || this.initialId === null,
  );

  constructor() {
    inject(DestroyRef).onDestroy((): void => this.destroyed.set(true));
  }

  protected cancel(): void {
    this.dialogRef.close();
  }

  protected unassign(): void {
    this.assign(null);
  }

  protected assign(id: number | null): void {
    // A second pick before the disabled picker repaints, or after a 409.
    if (this.locked()) return;
    if (id === this.initialId) return;
    this.saving.set(true);
    this.error.set(null);
    // Escape and the backdrop must not close the dialog while the request is in flight, and the
    // subscription is deliberately not tied to this component: the store applies a confirmed save
    // to the row even if the shell went away first.
    this.dialogRef.disableClose = true;
    this.data.store
      .saveTransaction(this.row, { kommentar: this.row.kommentar, umsatztyp_id: id })
      .subscribe({
        next: (): void => {
          if (!this.destroyed()) this.dialogRef.close();
        },
        error: (cause: unknown): void => {
          if (this.destroyed()) return;
          this.dialogRef.disableClose = false;
          this.saving.set(false);
          this.selectedId.set(this.initialId);
          this.error.set(toSaveError(cause));
        },
      });
  }
}
