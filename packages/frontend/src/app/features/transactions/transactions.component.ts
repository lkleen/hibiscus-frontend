import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import type {
  ColDef,
  GetRowIdParams,
  GridApi,
  GridReadyEvent,
  SizeColumnsToContentStrategy,
  ValueFormatterParams,
  ValueGetterParams,
} from 'ag-grid-community';
import { BaseTableComponent } from '../../core/components/base-table/base-table.component';
import { Category } from '../../core/models/category.model';
import type { TranslationKey } from '../../core/models/translation.model';
import { ApiService } from '../../core/services/api.service';
import { TranslationService } from '../../core/services/translation.service';
import { gridLocaleText } from '../../core/utils/grid-locale-text';
import { AmountCellComponent } from './cells/amount-cell/amount-cell.component';
import { CategoryCellComponent } from './cells/category-cell/category-cell.component';
import type { TransactionsGridContext } from './cells/transactions-grid-context';

/** Rows per grid page. */
const PAGE_SIZE = 20;

/** Empty text columns show a dash, like the other tables in the app. */
function textOrDash(params: ValueFormatterParams<TransactionRow, string | null>): string {
  return params.value === null || params.value === undefined || params.value.trim() === ''
    ? '—'
    : params.value;
}

function requireRow(data: TransactionRow | undefined): TransactionRow {
  if (!data) throw new Error('transactions grid row has no data');
  return data;
}

/** The `konto` columns shown next to every transaction (looked up through `konto_id`). */
type AccountField = 'name' | 'bic' | 'kontonummer' | 'bezeichnung';

/** Text columns of the `umsatz` row, shown exactly as stored. */
type TextField =
  | 'empfaenger_name'
  | 'empfaenger_konto'
  | 'empfaenger_blz'
  | 'zweck'
  | 'zweck2'
  | 'zweck3'
  | 'art'
  | 'gvcode'
  | 'endtoendid';

/**
 * The transactions table. The API serves every `umsatz` row as stored, all of them in one response;
 * sorting, filtering (column filters and the quick filter) and paging are ag-Grid's, on the loaded
 * rows. See the `transactions-table` skill.
 */
@Component({
  selector: 'app-transactions',
  templateUrl: './transactions.component.html',
  styleUrl: './transactions.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BaseTableComponent],
})
export class TransactionsComponent {
  private readonly api = inject(ApiService);
  protected readonly i18n = inject(TranslationService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly pageSize = PAGE_SIZE;

  protected readonly accounts = signal<AccountRow[]>([]);
  protected readonly categories = signal<Category[]>([]);
  /** Fed to ag-Grid's quick filter, which matches every column. */
  protected readonly q = signal('');

  protected readonly items = signal<TransactionRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);
  protected readonly categoryUpdateErrorId = signal<number | null>(null);

  private readonly accountsById = computed(
    () => new Map(this.accounts().map((account) => [account.id, account])),
  );
  private readonly categoriesById = computed(
    () => new Map(this.categories().map((category) => [category.id, category])),
  );

  private readonly gridApi = signal<GridApi<TransactionRow> | undefined>(undefined);

  protected readonly gridContext: TransactionsGridContext = {
    categories: this.categories,
    categoryUpdateErrorId: this.categoryUpdateErrorId,
    changeCategory: (transactionId, categoryId) => this.onCategoryChange(transactionId, categoryId),
  };

  protected readonly defaultColDef: ColDef<TransactionRow> = {
    filter: true,
    floatingFilter: true,
    suppressMovable: true,
    suppressHeaderMenuButton: true,
  };

  // ag-Grid sizes each column to its content, then scales up to fill the grid, and re-fits when the
  // data, the columns (e.g. a language switch changes the headers) or the grid width change.
  protected readonly autoSizeStrategy: SizeColumnsToContentStrategy = {
    type: 'fitCellContents',
    scaleUpToFitGridWidth: true,
    continuous: true,
  };

  // Header labels come from the translations, never from the (German, DB-mirroring) field names.
  // Every meaningful `umsatz` column is shown as stored; ids are resolved to what they identify
  // (the account's own columns, the category picker). The `initialSort`s only apply when a column
  // is created, so a later columnDefs update (accounts loading) keeps the user's sorting.
  protected readonly columnDefs = computed<ColDef<TransactionRow>[]>(() => {
    const accounts: Map<number, AccountRow> = this.accountsById();
    const categories: Map<number, Category> = this.categoriesById();
    const text = (field: TextField, label: TranslationKey): ColDef<TransactionRow> => ({
      field,
      headerName: this.i18n.t(label),
      cellDataType: 'text',
      valueFormatter: textOrDash,
    });
    // Not a column of `umsatz`: the value comes from the transaction's account (`konto_id`), which
    // may still be loading — then it shows the dash.
    const account = (field: AccountField, label: TranslationKey): ColDef<TransactionRow> => ({
      colId: `konto.${field}`,
      headerName: this.i18n.t(label),
      cellDataType: 'text',
      valueGetter: (params: ValueGetterParams<TransactionRow>): string | null =>
        accounts.get(requireRow(params.data).konto_id)?.[field] ?? null,
      valueFormatter: textOrDash,
    });
    return [
      // Not shown: only the tie-break of the initial sort (newest booking first).
      { field: 'id', initialHide: true, initialSort: 'desc', initialSortIndex: 1, filter: false },
      {
        field: 'datum',
        headerName: this.i18n.t('transactions.colDate'),
        cellDataType: 'dateString',
        initialSort: 'desc',
        initialSortIndex: 0,
      },
      {
        field: 'valuta',
        headerName: this.i18n.t('transactions.colValuta'),
        cellDataType: 'dateString',
      },
      account('name', 'transactions.colAccountHolder'),
      account('bic', 'transactions.colAccountBic'),
      account('kontonummer', 'transactions.colAccountNumber'),
      account('bezeichnung', 'transactions.colAccountLabel'),
      text('empfaenger_name', 'transactions.colRecipient'),
      text('empfaenger_konto', 'transactions.colRecipientAccount'),
      text('empfaenger_blz', 'transactions.colRecipientBank'),
      text('zweck', 'transactions.colPurpose1'),
      text('zweck2', 'transactions.colPurpose2'),
      text('zweck3', 'transactions.colPurpose3'),
      text('art', 'transactions.colBookingType'),
      text('gvcode', 'transactions.colTransactionCode'),
      text('endtoendid', 'transactions.colEndToEndId'),
      {
        field: 'betrag',
        headerName: this.i18n.t('transactions.colAmount'),
        type: 'rightAligned',
        cellDataType: 'number',
        cellRenderer: AmountCellComponent,
      },
      {
        field: 'saldo',
        headerName: this.i18n.t('transactions.colBalance'),
        type: 'rightAligned',
        cellDataType: 'number',
        cellRenderer: AmountCellComponent,
      },
      {
        // The cell shows the category picker; sorting and filtering work on the category's name.
        colId: 'category',
        headerName: this.i18n.t('transactions.colCategory'),
        cellDataType: 'text',
        autoHeight: true,
        valueGetter: (params: ValueGetterParams<TransactionRow>): string | null => {
          const categoryId: number | null = requireRow(params.data).umsatztyp_id;
          return categoryId === null ? null : (categories.get(categoryId)?.name ?? null);
        },
        cellRenderer: CategoryCellComponent,
      },
    ];
  });

  protected readonly localeText = computed<Record<string, string>>(() => ({
    ...gridLocaleText(this.i18n),
    loadingOoo: this.i18n.t('transactions.loading'),
  }));

  protected readonly getRowId = (params: GetRowIdParams<TransactionRow>): string =>
    String(params.data.id);

  constructor() {
    this.api
      .getAccounts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((accounts) => this.accounts.set(accounts));

    this.api
      .getCategories()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((categories) => this.categories.set(categories));

    this.api
      .getTransactions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (items) => {
          this.items.set(items);
          this.loading.set(false);
        },
        error: () => {
          this.error.set(true);
          this.loading.set(false);
        },
      });
  }

  protected onGridReady(event: GridReadyEvent<TransactionRow>): void {
    this.gridApi.set(event.api);
  }

  protected onSearchInput(event: Event): void {
    this.q.set((event.target as HTMLInputElement).value);
  }

  private onCategoryChange(transactionId: number, categoryId: number | null): void {
    this.categoryUpdateErrorId.set(null);
    this.api
      .updateTransactionCategory(transactionId, { categoryId })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.applyCategory(transactionId, categoryId),
        error: () => this.categoryUpdateErrorId.set(transactionId),
      });
  }

  // The backend answers 204, so the change is applied to the row the grid holds. A transaction
  // update (not new `rowData`) keeps the user's page, sorting and filters, and re-evaluates them.
  private applyCategory(transactionId: number, categoryId: number | null): void {
    const api: GridApi<TransactionRow> | undefined = this.gridApi();
    if (!api) throw new Error('transactions grid is not ready');
    const row: TransactionRow | undefined = api.getRowNode(String(transactionId))?.data;
    if (!row) throw new Error(`transaction ${transactionId} is not in the grid`);
    api.applyTransaction({ update: [{ ...row, umsatztyp_id: categoryId }] });
  }
}
