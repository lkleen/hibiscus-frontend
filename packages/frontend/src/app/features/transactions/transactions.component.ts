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
import { ApiService } from '../../core/services/api.service';
import { TranslationService } from '../../core/services/translation.service';
import { DataTableCellDirective } from '../../shared/components/data-table/data-table-cell.directive';
import { DataTableComponent } from '../../shared/components/data-table/data-table.component';
import {
  colDef,
  type DataTableColDef,
  type DataTableOptions,
} from '../../shared/components/data-table/data-table.model';
import { DateRange, isInRange } from '../../core/utils/date-range';
import { DateRangeFilterComponent } from '../../shared/components/date-range-filter/date-range-filter.component';
import { AccountFilterComponent } from './account-filter/account-filter.component';
import { AmountCellComponent } from './cells/amount-cell/amount-cell.component';

/**
 * The transactions table. The API serves every `umsatz` row as stored, all of them in one
 * request; sorting, filtering (column filters and the global filter) and paging are
 * `<app-data-table>`'s (a PrimeNG `p-table` underneath), on the loaded rows. See the
 * `transactions-table` skill.
 */
@Component({
  selector: 'app-transactions',
  templateUrl: './transactions.component.html',
  styleUrl: './transactions.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DataTableComponent,
    DataTableCellDirective,
    DateRangeFilterComponent,
    AccountFilterComponent,
    AmountCellComponent,
  ],
})
export class TransactionsComponent {
  private readonly api = inject(ApiService);
  protected readonly i18n = inject(TranslationService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly accounts = signal<AccountRow[]>([]);

  protected readonly items = signal<TransactionRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);

  /** Session-only; the date filter picks its initial value (the first preset) itself. */
  protected readonly range = signal<DateRange | null>(null);

  /** Session-only; empty = every account checked, so late-loading accounts start checked too. */
  protected readonly excludedAccountIds = signal<ReadonlySet<number>>(new Set<number>());

  /**
   * The table's external filter: the booking date within the range and the account not excluded.
   * `null` when neither restricts anything, so the table skips the pass entirely.
   */
  protected readonly rowFilter = computed<((row: TransactionRow) => boolean) | null>(() => {
    const range: DateRange | null = this.range();
    const excluded: ReadonlySet<number> = this.excludedAccountIds();
    if (range === null && excluded.size === 0) return null;
    return (row: TransactionRow): boolean =>
      !excluded.has(row.konto_id) && (range === null || isInRange(row.datum, range));
  });

  private readonly accountsById = computed(
    () => new Map(this.accounts().map((account) => [account.id, account])),
  );

  // Every lookup below is a `valueGetter` calling straight into the live `accountsById()`
  // signal rather than a snapshot captured once — the row stays raw (skill
  // §2/§3), and the table only ever sees the id-resolved *name*, never the id itself. Reading a
  // signal from inside a `valueGetter` closure that runs during `<app-data-table>`'s own change
  // detection still registers as one of *that* render's dependencies, so a late-arriving
  // account list repaints the table once it loads. This array itself reads no signal —
  // only the closures do, lazily, when the table calls them — so it's a plain field, built once,
  // not a `computed` that would never re-run.
  protected readonly columns: readonly DataTableColDef<TransactionRow>[] = [
    { colId: 'datum', headerKey: 'transactions.colDate', filter: 'date' },
    { colId: 'valuta', headerKey: 'transactions.colValuta', filter: 'date' },
    colDef<TransactionRow, string | null>({
      colId: 'konto_name',
      headerKey: 'transactions.colAccountHolder',
      valueGetter: (row) => this.accountsById().get(row.konto_id)?.name ?? null,
    }),
    colDef<TransactionRow, string | null>({
      colId: 'konto_bic',
      headerKey: 'transactions.colAccountBic',
      valueGetter: (row) => this.accountsById().get(row.konto_id)?.bic ?? null,
    }),
    colDef<TransactionRow, string | null>({
      colId: 'konto_kontonummer',
      headerKey: 'transactions.colAccountNumber',
      valueGetter: (row) => this.accountsById().get(row.konto_id)?.kontonummer ?? null,
    }),
    colDef<TransactionRow, string | null>({
      colId: 'konto_bezeichnung',
      headerKey: 'transactions.colAccountLabel',
      valueGetter: (row) => this.accountsById().get(row.konto_id)?.bezeichnung ?? null,
    }),
    { colId: 'empfaenger_name', headerKey: 'transactions.colRecipient' },
    { colId: 'empfaenger_konto', headerKey: 'transactions.colRecipientAccount' },
    { colId: 'empfaenger_blz', headerKey: 'transactions.colRecipientBank' },
    { colId: 'zweck', headerKey: 'transactions.colPurpose1' },
    { colId: 'zweck2', headerKey: 'transactions.colPurpose2' },
    { colId: 'zweck3', headerKey: 'transactions.colPurpose3' },
    { colId: 'art', headerKey: 'transactions.colBookingType' },
    { colId: 'gvcode', headerKey: 'transactions.colTransactionCode' },
    { colId: 'endtoendid', headerKey: 'transactions.colEndToEndId' },
    {
      colId: 'betrag',
      headerKey: 'transactions.colAmount',
      cellRenderer: 'amount',
      align: 'end',
      filter: 'numeric',
    },
    {
      colId: 'saldo',
      headerKey: 'transactions.colBalance',
      cellRenderer: 'amount',
      align: 'end',
      filter: 'numeric',
    },
    {
      // The column exists only to carry the id tie-break for `options.defaultSort` below.
      colId: 'id',
      hide: true,
      filter: false,
    },
  ];

  // Newest booking first, ties broken by the newest id — same default the old grid had.
  protected readonly options: DataTableOptions<TransactionRow> = {
    getRowId: (row) => row.id,
    defaultSort: [
      { colId: 'datum', order: -1 },
      { colId: 'id', order: -1 },
    ],
    autoSizeStrategy: { type: 'fitCellContents' },
    minWidth: '82rem',
    scrollHeight: 'flex',
    emptyKey: 'transactions.empty',
  };

  constructor() {
    this.api
      .getAccounts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((accounts) => this.accounts.set(accounts));

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

  // `DataTableCellContext.value` is `unknown` by design — a cell renderer can be shared by columns
  // with different `Value` types, so the data-table component has no honest concrete type to hand
  // back (see the `colDef()` doc comment in `data-table.model.ts` for the same erasure). Narrowing
  // here, once, keeps the "amount" template's binding to `<app-transaction-amount-cell>` typed
  // without a template-level `$any()` cast. Fails loudly rather than defensively: the "amount"
  // renderer is only ever wired to `betrag`/`saldo`, both `number | null`, so anything else here
  // means a column was mis-wired to this renderer, not a value worth silently coercing to `null`.
  protected asAmount(value: unknown): number | null {
    if (value === null || typeof value === 'number') return value;
    throw new Error(`amount cell expects number | null, got ${typeof value}`);
  }
}
