import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import type {
  TransactionEditableFields,
  TransactionRow,
} from '@hibiscus-frontend/shared/contracts/transactions';
import { TranslationService } from '../../../core/services/translation.service';
import { toCssColor } from '../../../core/utils/category-color';
import { APP_DIALOG_CLASS } from '../../../shared/dialog/dialog-classes';
import { DataTableCellDirective } from '../../../shared/components/data-table/data-table-cell.directive';
import { DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import {
  colDef,
  type DataTableColDef,
  type DataTableOptions,
} from '../../../shared/components/data-table/data-table.model';
import { AmountCellComponent } from '../cells/amount-cell/amount-cell.component';
import type { TransactionsStore } from '../transactions.store';

/** The `ariaLabelledBy` target of the dialog. */
export const TRANSACTION_EDIT_TITLE_ID = 'transaction-edit-title';
/** The comment textarea; the service focuses it when the dialog opens. */
export const TRANSACTION_EDIT_COMMENT_ID = 'transaction-edit-comment';

/** What `TransactionEditDialog` hands to the dialog. */
export interface TransactionEditDialogData {
  readonly row: TransactionRow;
  readonly store: TransactionsStore;
}

type SaveError = 'conflict' | 'generic';

/** An empty comment is stored as NULL, like a comment that was never set. */
function normalizeComment(comment: string | null): string | null {
  return comment === null || comment === '' ? null : comment;
}

/**
 * Edits a transaction's comment and category. The category is picked in a single-selection tree
 * (`<app-data-table>`); "No category" unsets it. The save carries the values the dialog started
 * from, so the backend rejects it (409) when the row changed elsewhere in the meantime.
 */
@Component({
  selector: 'app-transaction-edit-dialog',
  templateUrl: './transaction-edit-dialog.component.html',
  styleUrl: './transaction-edit-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: APP_DIALOG_CLASS },
  imports: [DataTableComponent, DataTableCellDirective, AmountCellComponent],
})
export class TransactionEditDialogComponent {
  protected readonly i18n = inject(TranslationService);
  private readonly data: TransactionEditDialogData = inject<TransactionEditDialogData>(DIALOG_DATA);
  private readonly dialogRef: DialogRef<void, TransactionEditDialogComponent> =
    inject<DialogRef<void, TransactionEditDialogComponent>>(DialogRef);
  private readonly destroyed = signal<boolean>(false);

  protected readonly row: TransactionRow = this.data.row;
  protected readonly titleId: string = TRANSACTION_EDIT_TITLE_ID;
  protected readonly commentId: string = TRANSACTION_EDIT_COMMENT_ID;

  // The values the dialog started from; "unchanged" is measured against these.
  private readonly initial: TransactionEditableFields = {
    kommentar: normalizeComment(this.row.kommentar),
    umsatztyp_id: this.row.umsatztyp_id,
  };

  protected readonly comment = signal<string>(this.row.kommentar ?? '');
  protected readonly categoryId = signal<number | null>(this.row.umsatztyp_id);
  protected readonly saving = signal<boolean>(false);
  protected readonly error = signal<SaveError | null>(null);

  protected readonly changed = computed<boolean>(
    () =>
      normalizeComment(this.comment()) !== this.initial.kommentar ||
      this.categoryId() !== this.initial.umsatztyp_id,
  );
  protected readonly canSave = computed<boolean>(
    () => this.changed() && !this.saving() && this.error() !== 'conflict',
  );

  /** The chosen category as its path from the root, or "No category". */
  protected readonly categoryLabel = computed<string>(() => {
    const id: number | null = this.categoryId();
    if (id === null) return this.i18n.t('transactions.edit.noCategory');
    return this.data.store.categoryPathsById().get(id) ?? String(id);
  });

  protected readonly categories = this.data.store.categories;

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

  constructor() {
    inject(DestroyRef).onDestroy((): void => this.destroyed.set(true));
  }

  protected swatchColor(category: CategoryRow): string | null {
    return toCssColor(category);
  }

  protected onCommentInput(event: Event): void {
    const target: EventTarget | null = event.target;
    if (!(target instanceof HTMLTextAreaElement)) throw new Error('expected a textarea event');
    this.comment.set(target.value);
  }

  protected clearCategory(): void {
    this.categoryId.set(null);
  }

  protected onCategoryPicked(id: string | number | null): void {
    // The table only emits ids of selected rows, and a re-click keeps the selection.
    if (id === null) return;
    if (typeof id !== 'number') throw new Error(`category id must be a number, got ${typeof id}`);
    this.categoryId.set(id);
  }

  protected cancel(): void {
    this.dialogRef.close();
  }

  protected save(): void {
    // A second click before the disabled button repaints.
    if (this.saving()) return;
    if (!this.canSave()) throw new Error('nothing to save');
    const next: TransactionEditableFields = {
      kommentar: normalizeComment(this.comment()),
      umsatztyp_id: this.categoryId(),
    };
    this.saving.set(true);
    this.error.set(null);
    // Escape and the backdrop must not close the dialog while the request is in flight, and the
    // subscription is deliberately not tied to this component: the store applies a confirmed save
    // to the row even if the shell went away first.
    this.dialogRef.disableClose = true;
    this.data.store.saveTransaction(this.row, next).subscribe({
      next: (): void => {
        if (!this.destroyed()) this.dialogRef.close();
      },
      error: (cause: unknown): void => {
        if (this.destroyed()) return;
        this.dialogRef.disableClose = false;
        this.saving.set(false);
        this.error.set(
          cause instanceof HttpErrorResponse && cause.status === 409 ? 'conflict' : 'generic',
        );
      },
    });
  }
}
