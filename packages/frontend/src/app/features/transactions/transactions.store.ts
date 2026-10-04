import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import { forkJoin } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { DateRange, isInRange } from '../../core/utils/date-range';
import { quickFilterMatches } from '../../shared/components/data-table/data-table.defaults';
import {
  colDef,
  type DataTableColDef,
  type DataTableOptions,
} from '../../shared/components/data-table/data-table.model';

import { assignCategories, type CategoryAssignment } from './by-category/category-assignment';

const SEARCH_DEBOUNCE_MS = 300;

/**
 * State shared by the transaction views (tabs): the data, loaded once when the shell is created,
 * and the one set of filters. Provided in the shell's `providers`, so it lives exactly as long as
 * the shell and switching tabs never refetches.
 */
@Injectable()
export class TransactionsStore {
  private readonly api = inject(ApiService);

  readonly accounts = signal<readonly AccountRow[]>([]);
  readonly transactions = signal<readonly TransactionRow[]>([]);
  readonly categories = signal<readonly CategoryRow[]>([]);
  readonly loading = signal(true);
  readonly error = signal(false);

  /** Session-only; the date filter picks its initial value (the first preset) itself. */
  readonly range = signal<DateRange | null>(null);

  /** Session-only; empty = every account checked, so late-loading accounts start checked too. */
  readonly excludedAccountIds = signal<ReadonlySet<number>>(new Set<number>());

  /** The raw search text, bound to the input. */
  readonly searchInput = signal('');
  private readonly debouncedSearch = signal('');
  /** `searchInput`, delayed so typing does not re-filter ~10,000 rows on every keystroke. */
  readonly search = this.debouncedSearch.asReadonly();

  readonly accountsById = computed<ReadonlyMap<number, AccountRow>>(
    () => new Map(this.accounts().map((account: AccountRow) => [account.id, account])),
  );

  // Every lookup below is a `valueGetter` calling straight into the live `accountsById()`
  // signal rather than a snapshot captured once — the row stays raw (skill
  // §2/§3), and the table only ever sees the id-resolved *name*, never the id itself. Reading a
  // signal from inside a `valueGetter` closure that runs during `<app-data-table>`'s own change
  // detection still registers as one of *that* render's dependencies, so a late-arriving
  // account list repaints the table once it loads. This array itself reads no signal —
  // only the closures do, lazily, when the table calls them — so it's a plain field, built once,
  // not a `computed` that would never re-run.
  readonly transactionColumns: readonly DataTableColDef<TransactionRow>[] = [
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
      // The column exists only to carry the id tie-break for `listOptions.defaultSort` below.
      colId: 'id',
      hide: true,
      filter: false,
    },
  ];

  // Newest booking first, ties broken by the newest id — same default the old grid had.
  // The shell owns the search field, so the table's own is off.
  readonly listOptions: DataTableOptions<TransactionRow> = {
    getRowId: (row) => row.id,
    defaultSort: [
      { colId: 'datum', order: -1 },
      { colId: 'id', order: -1 },
    ],
    autoSizeStrategy: { type: 'fitCellContents' },
    minWidth: '82rem',
    scrollHeight: 'flex',
    emptyKey: 'transactions.empty',
    quickFilter: false,
  };

  /**
   * The filter every view applies: account not excluded, booking date within the range and the
   * search matching. `null` when none of them restricts anything, so views skip the pass entirely.
   */
  readonly rowFilter = computed<((row: TransactionRow) => boolean) | null>(() => {
    const range: DateRange | null = this.range();
    const excluded: ReadonlySet<number> = this.excludedAccountIds();
    const search: string = this.search();
    if (range === null && excluded.size === 0 && search.trim() === '') return null;
    return (row: TransactionRow): boolean =>
      !excluded.has(row.konto_id) &&
      (range === null || isInRange(row.datum, range)) &&
      quickFilterMatches(row, this.transactionColumns, search);
  });

  readonly filteredTransactions = computed<readonly TransactionRow[]>(() => {
    const filter: ((row: TransactionRow) => boolean) | null = this.rowFilter();
    const transactions: readonly TransactionRow[] = this.transactions();
    return filter ? transactions.filter(filter) : transactions;
  });

  /**
   * Every transaction's category (stored id or pattern match), over ALL transactions — never the
   * filters, so a transaction's category does not depend on what is currently shown.
   */
  readonly categoryAssignment = computed<CategoryAssignment>(() => {
    if (this.loading()) return { byTransactionId: new Map(), invalidPatterns: [] };
    return assignCategories({
      transactions: this.transactions(),
      categories: this.categories(),
      accountsById: this.accountsById(),
    });
  });

  constructor() {
    // The effect's cleanup clears a pending timer on every change and on destroy.
    effect((onCleanup) => {
      const value: string = this.searchInput();
      const timer: ReturnType<typeof setTimeout> = setTimeout(
        () => this.debouncedSearch.set(value),
        SEARCH_DEBOUNCE_MS,
      );
      onCleanup(() => clearTimeout(timer));
    });

    forkJoin({
      accounts: this.api.getAccounts(),
      transactions: this.api.getTransactions(),
      categories: this.api.getCategories(),
    })
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe({
        next: ({ accounts, transactions, categories }) => {
          this.accounts.set(accounts);
          this.transactions.set(transactions);
          this.categories.set(categories);
          this.loading.set(false);
        },
        error: () => {
          this.error.set(true);
          this.loading.set(false);
        },
      });
  }
}
