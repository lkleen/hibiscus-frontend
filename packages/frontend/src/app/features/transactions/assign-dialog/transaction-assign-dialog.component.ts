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
  conflictCountOf,
  toSaveError,
  type SaveError,
  type TransactionAssignDialogData,
} from '../transaction-dialogs.model';

/** The `ariaLabelledBy` target of the dialog. */
export const TRANSACTION_ASSIGN_TITLE_ID = 'transaction-assign-title';

/**
 * Assigns one or several transactions to a category: picking one in the tree saves at once ("No
 * category" unassigns), leaving the comments untouched. The save carries the categories the dialog
 * started from, so the backend rejects it (409, nothing saved) when a row changed elsewhere in the
 * meantime. The dialog keeps the rows it was opened with, whatever happens to the page's selection.
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
  private readonly data: TransactionAssignDialogData =
    inject<TransactionAssignDialogData>(DIALOG_DATA);
  private readonly dialogRef: DialogRef<void, TransactionAssignDialogComponent> =
    inject<DialogRef<void, TransactionAssignDialogComponent>>(DialogRef);
  private readonly destroyed = signal<boolean>(false);

  protected readonly rows: readonly TransactionRow[] = this.data.rows;
  protected readonly titleId: string = TRANSACTION_ASSIGN_TITLE_ID;
  protected readonly categories = this.data.store.categories;

  // The category all rows share, or `undefined` when they differ; "unchanged" is measured
  // against it. `null` is a shared "no category".
  private readonly initialId: number | null | undefined = ((): number | null | undefined => {
    const first: number | null = this.rows[0].umsatztyp_id;
    return this.rows.every((row: TransactionRow) => row.umsatztyp_id === first) ? first : undefined;
  })();
  private readonly allUnassigned: boolean = this.rows.every(
    (row: TransactionRow) => row.umsatztyp_id === null,
  );

  /** The tree's selection: the current category, or the pick that is being saved. */
  protected readonly selectedId = signal<number | null>(this.initialId ?? null);
  protected readonly saving = signal<boolean>(false);
  protected readonly error = signal<SaveError | null>(null);
  /** How many of several rows the 409 reported as changed elsewhere. */
  protected readonly conflictCount = signal<number>(0);

  /** No pick or "No category" while a save runs, or after the row proved stale. */
  protected readonly locked = computed<boolean>(() => this.saving() || this.error() === 'conflict');

  /** The current category as its path from the root, "No category", or "Mixed categories". */
  protected readonly categoryLabel = computed<string>(() => {
    if (this.initialId === undefined) return this.i18n.t('transactions.assign.mixed');
    if (this.initialId === null) return this.i18n.t('transactions.edit.noCategory');
    return this.data.store.categoryPathsById().get(this.initialId) ?? String(this.initialId);
  });

  protected readonly unassignDisabled = computed<boolean>(
    () => this.locked() || this.allUnassigned,
  );

  /** The conflict text: with a count for several rows, the single-row wording for one. */
  protected readonly conflictText = computed<string>(() =>
    this.rows.length === 1
      ? this.i18n.t('transactions.edit.conflict')
      : this.i18n.t('transactions.assign.conflictMany', { count: this.conflictCount() }),
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
    if (this.initialId !== undefined && id === this.initialId) return;
    this.saving.set(true);
    this.error.set(null);
    // Escape and the backdrop must not close the dialog while the request is in flight, and the
    // subscription is deliberately not tied to this component: the store applies a confirmed save
    // to the row even if the shell went away first.
    this.dialogRef.disableClose = true;
    this.data.store.assignCategory(this.rows, id).subscribe({
      next: (): void => {
        // A confirmed save: the page may drop its selection even if this dialog is gone.
        this.data.onAssigned?.();
        if (!this.destroyed()) this.dialogRef.close();
      },
      error: (cause: unknown): void => {
        if (this.destroyed()) return;
        this.dialogRef.disableClose = false;
        this.saving.set(false);
        this.selectedId.set(this.initialId ?? null);
        this.fail(cause);
      },
    });
  }

  private fail(cause: unknown): void {
    let failure: SaveError = toSaveError(cause);
    if (failure === 'conflict' && this.rows.length > 1) {
      // A 409 without the conflicting ids is not the contract's conflict: show the generic error.
      const count: number | null = conflictCountOf(cause);
      if (count === null) failure = 'generic';
      else this.conflictCount.set(count);
    }
    this.error.set(failure);
  }
}
