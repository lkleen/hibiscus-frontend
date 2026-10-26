import { Dialog, type DialogRef } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  output,
  signal,
  type Signal,
} from '@angular/core';
import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import { LocaleService } from '../../../core/services/locale.service';
import { TranslationService } from '../../../core/services/translation.service';
import { TaxTagDialogs } from '../../../core/tax/tax-tag-dialog/tax-tag-dialogs';
import { DataTableCellDirective } from '../../../shared/components/data-table/data-table-cell.directive';
import { DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import {
  colDef,
  type DataTableColDef,
  type DataTableMenuItem,
  type DataTableOptions,
} from '../../../shared/components/data-table/data-table.model';
import {
  APP_DIALOG_BACKDROP_CLASS,
  APP_DIALOG_PANEL_CLASS,
} from '../../../shared/dialog/dialog-classes';
import { CategoryDialogs } from '../../categories/category-dialogs';
import { categoryDraftFrom } from '../../categories/category-draft';
import { CATEGORY_PICKER_SEARCH_SELECTOR } from '../../transactions/category-picker/category-picker.component';
import { AmountCellComponent } from '../../transactions/cells/amount-cell/amount-cell.component';
import { TransactionDialogs } from '../../transactions/transaction-dialogs';
import { TaxEuroPipe } from '../tax-euro.pipe';
import { TaxReturnStore } from '../tax-return.store';
import type { TaxStep } from '../wizard/tax-step';
import {
  CATEGORY_PICK_TITLE_ID,
  CategoryPickDialogComponent,
  type CategoryPickDialogData,
} from './category-pick-dialog.component';

/** The row-menu entry `TransactionDialogs.menuItems` opens the category dialog with. */
const CREATE_CATEGORY_KEY = 'transactions.menuCreateCategory';

/**
 * Step ②: the year's transactions that no category catches (no stored category, no matching
 * pattern), largest amounts first. They are assigned, or caught by a new or widened category,
 * through the transactions views' own dialogs; an assigned row leaves the list at once. After a
 * category is created here, the tax-section dialog asks for its section (skippable).
 */
@Component({
  selector: 'app-tax-step-unassigned',
  templateUrl: './step-unassigned.component.html',
  styleUrls: ['../tax-ui.scss', './step-unassigned.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DataTableComponent, DataTableCellDirective, AmountCellComponent, TaxEuroPipe],
})
export class StepUnassignedComponent {
  protected readonly i18n = inject(TranslationService);
  protected readonly store = inject(TaxReturnStore);
  protected readonly locale = inject(LocaleService).locale;
  private readonly transactionDialogs = inject(TransactionDialogs);
  private readonly categoryDialogs = inject(CategoryDialogs);
  private readonly tagDialogs = inject(TaxTagDialogs);
  private readonly dialog = inject(Dialog);
  private pickRef: DialogRef<CategoryRow> | null = null;

  /** Asks the wizard to show another step. */
  readonly go = output<TaxStep>();

  protected readonly year: Signal<number> = computed((): number => this.store.report().year);

  /** The transactions list's columns, plus a hidden one to sort by the absolute amount. */
  protected readonly columns: readonly DataTableColDef<TransactionRow>[] = [
    ...this.store.transactions.transactionColumns,
    colDef<TransactionRow, number>({
      colId: 'betrag_abs',
      hide: true,
      valueGetter: (row) => Math.abs(row.betrag),
      filter: false,
    }),
  ];

  protected readonly options: DataTableOptions<TransactionRow> = {
    ...this.store.transactions.listOptions,
    defaultSort: [
      { colId: 'betrag_abs', order: -1 },
      { colId: 'id', order: 1 },
    ],
    quickFilter: {},
    scrollHeight: '36rem',
    emptyKey: 'tax.unassigned.emptyFilter',
    rowSelection: { mode: 'multiple' },
    getContextMenuItems: ({ row, selectedRows }): readonly DataTableMenuItem[] =>
      this.transactionDialogs
        .menuItems({
          row,
          selectedRows,
          view: 'showDetails',
          onBulkAssigned: (): void => this.clearSelection(),
        })
        .map((item: DataTableMenuItem): DataTableMenuItem =>
          typeof item === 'object' &&
          'nameKey' in item &&
          item.nameKey === CREATE_CATEGORY_KEY &&
          item.disabled !== true
            ? { ...item, action: (): void => this.createCategoryFrom(row) }
            : item,
        ),
  };

  /** Only the year's unassigned rows; a new function whenever that set changes (see the
   *  `externalFilter` contract). */
  protected readonly filter: Signal<(row: TransactionRow) => boolean> = computed(() => {
    const ids: ReadonlySet<number> = new Set(
      this.store.unassignedRows().map((row: TransactionRow): number => row.id),
    );
    return (row: TransactionRow): boolean => ids.has(row.id);
  });

  protected readonly selectedRowIds = signal<ReadonlySet<string | number>>(new Set());

  protected readonly selectedRows: Signal<readonly TransactionRow[]> = computed(
    (): readonly TransactionRow[] => {
      const ids: ReadonlySet<string | number> = this.selectedRowIds();
      return this.store.unassignedRows().filter((row: TransactionRow): boolean => ids.has(row.id));
    },
  );

  protected readonly selectedSum: Signal<number> = computed(
    (): number =>
      this.selectedRows().reduce(
        (sum: number, row: TransactionRow): number => sum + Math.round(row.betrag * 100),
        0,
      ) / 100,
  );

  constructor() {
    inject(DestroyRef).onDestroy((): void => this.pickRef?.close());
  }

  protected clearSelection(): void {
    this.selectedRowIds.set(new Set());
  }

  protected assignSelected(): void {
    this.transactionDialogs.openAssign(this.selectedRows(), (): void => this.clearSelection());
  }

  /** "Edit a category…": pick one, then edit it in the category dialog (e.g. widen its pattern). */
  protected editCategory(): void {
    this.pickRef?.close();
    const data: CategoryPickDialogData = { categories: this.store.transactions.categories() };
    const ref: DialogRef<CategoryRow> = this.dialog.open<CategoryRow, CategoryPickDialogData>(
      CategoryPickDialogComponent,
      {
        data,
        ariaLabelledBy: CATEGORY_PICK_TITLE_ID,
        panelClass: APP_DIALOG_PANEL_CLASS,
        backdropClass: APP_DIALOG_BACKDROP_CLASS,
        autoFocus: CATEGORY_PICKER_SEARCH_SELECTOR,
      },
    );
    this.pickRef = ref;
    ref.closed.subscribe((category: CategoryRow | undefined): void => {
      if (this.pickRef === ref) this.pickRef = null;
      if (category !== undefined) {
        this.categoryDialogs.openEdit(this.store.transactions, category);
      }
    });
  }

  protected asAmount(value: unknown): number | null {
    if (value === null || typeof value === 'number') return value;
    throw new Error(`amount cell expects number | null, got ${typeof value}`);
  }

  /** The category dialog prefilled from `row`; a created category is then asked for its section. */
  private createCategoryFrom(row: TransactionRow): void {
    this.categoryDialogs
      .openCreate(this.store.transactions, categoryDraftFrom(row))
      .subscribe((created: CategoryRow | undefined): void => {
        if (created === undefined) return;
        this.tagDialogs.openSection(created, true).subscribe();
      });
  }
}
