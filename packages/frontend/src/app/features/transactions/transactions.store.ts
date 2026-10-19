import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import type {
  TransactionAssignItem,
  TransactionAssignRequest,
  TransactionEditableFields,
  TransactionRow,
  TransactionUpdateRequest,
} from '@hibiscus-frontend/shared/contracts/transactions';
import { Observable, forkJoin, tap } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { TranslationService } from '../../core/services/translation.service';
import { accountsSummary } from './account-filter/accounts-summary';
import type {
  CategorySave,
  CategoryEditSource,
} from '../categories/edit-dialog/category-edit-dialog.model';
import { saveCategoryInto } from '../categories/save-category';
import { categoryPaths } from '../../core/utils/category-path';
import { DateRange, isInRange } from '../../core/utils/date-range';
import { quickFilterMatches } from '../../shared/components/data-table/data-table.defaults';
import {
  colDef,
  type DataTableColDef,
  type DataTableOptions,
} from '../../shared/components/data-table/data-table.model';

import { assignCategories, type CategoryAssignment } from '../../core/utils/category-matching';

const SEARCH_DEBOUNCE_MS = 300;

/**
 * State shared by the transaction views (tabs): the data, loaded once when the shell is created,
 * and the one set of filters. Provided in the shell's `providers`, so it lives exactly as long as
 * the shell and switching tabs never refetches.
 */
@Injectable()
export class TransactionsStore implements CategoryEditSource {
  private readonly api = inject(ApiService);
  private readonly i18n = inject(TranslationService);

  readonly accounts = signal<readonly AccountRow[]>([]);
  readonly transactions = signal<readonly TransactionRow[]>([]);
  readonly categories = signal<readonly CategoryRow[]>([]);
  readonly loading = signal(true);
  readonly error = signal(false);

  /**
   * Bumped after every saved edit. The derived views read it so they recompute; `rowFilter` does
   * not, so an edit never changes the filter and the list keeps its page.
   */
  readonly revision = signal<number>(0);

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

  /** Every category's root-to-leaf name path, computed once per load rather than per cell. */
  readonly categoryPathsById = computed<ReadonlyMap<number, string>>(() =>
    categoryPaths(this.categories()),
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
    { colId: 'valuta', headerKey: 'transactions.colValuta', filter: 'date' },
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
    { colId: 'zweck', headerKey: 'transactions.colPurpose1' },
    { colId: 'zweck2', headerKey: 'transactions.colPurpose2' },
    { colId: 'zweck3', headerKey: 'transactions.colPurpose3' },
    { colId: 'datum', headerKey: 'transactions.colDate', filter: 'date' },
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
    { colId: 'art', headerKey: 'transactions.colBookingType' },
    { colId: 'gvcode', headerKey: 'transactions.colTransactionCode' },
    { colId: 'endtoendid', headerKey: 'transactions.colEndToEndId' },
    // The *stored* category only, resolved like `konto_id` above — not the pattern-matched one
    // the by-category tab groups by (skill §2.5).
    colDef<TransactionRow, string | null>({
      colId: 'umsatztyp_path',
      headerKey: 'transactions.colCategory',
      valueGetter: (row) =>
        row.umsatztyp_id === null ? null : (this.categoryPathsById().get(row.umsatztyp_id) ?? null),
    }),
    { colId: 'kommentar', headerKey: 'transactions.colComment' },
    { colId: 'flags', headerKey: 'transactions.colFlags', filter: 'numeric' },
    {
      // The column exists only to carry the id tie-break for `listOptions.defaultSort` below.
      colId: 'id',
      hide: true,
      filter: false,
    },
  ];

  // Earliest value date first, ties broken by the oldest id.
  // The shell owns the search field, so the table's own is off. The row menu lives in
  // `TransactionsListComponent` (its Edit entry opens a dialog, which the store must not know).
  readonly listOptions: DataTableOptions<TransactionRow> = {
    getRowId: (row) => row.id,
    defaultSort: [
      { colId: 'valuta', order: 1 },
      { colId: 'id', order: 1 },
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

  /**
   * The account selection as one line ("All accounts", "2 of 3 accounts", …): the Filter band's
   * state text and the export's scope.
   */
  readonly accountsText = computed<string>((): string =>
    accountsSummary({
      accounts: this.accounts(),
      excludedIds: this.excludedAccountIds(),
      i18n: this.i18n,
    }),
  );

  /** `from – to`, or the "All dates" label while no range is set: the Period band's state text
   *  and the export's scope. */
  readonly periodText = computed<string>((): string => {
    const range: DateRange | null = this.range();
    if (range === null) return this.i18n.t('dateRangeFilter.allDates');
    return `${range.from ?? '…'} – ${range.to ?? '…'}`;
  });

  readonly filteredTransactions = computed<readonly TransactionRow[]>(() => {
    this.revision(); // Recompute after an in-place edit (see `saveTransaction`).
    const filter: ((row: TransactionRow) => boolean) | null = this.rowFilter();
    const transactions: readonly TransactionRow[] = this.transactions();
    return filter ? transactions.filter(filter) : transactions;
  });

  /**
   * Every transaction's category (stored id or pattern match), over ALL transactions — never the
   * filters, so a transaction's category does not depend on what is currently shown.
   */
  readonly categoryAssignment = computed<CategoryAssignment>(() => {
    this.revision(); // Recompute after an in-place edit (see `saveTransaction`).
    if (this.loading()) return { byTransactionId: new Map(), invalidPatterns: [] };
    return assignCategories({
      transactions: this.transactions(),
      categories: this.categories(),
      accountsById: this.accountsById(),
    });
  });

  /**
   * Saves an edit to a stored transaction. On success the row is mutated in place instead of
   * replaced: swapping the row or the array would reset PrimeNG's page (`transactions-table`
   * skill §3). `revision` then tells the derived views that the stored values changed. Errors
   * propagate to the caller, and the row stays untouched.
   */
  saveTransaction(row: TransactionRow, next: TransactionEditableFields): Observable<void> {
    const request: TransactionUpdateRequest = {
      expected: { kommentar: row.kommentar, umsatztyp_id: row.umsatztyp_id },
      next,
    };
    return this.api.updateTransaction(row.id, request).pipe(
      tap((): void => {
        row.kommentar = next.kommentar;
        row.umsatztyp_id = next.umsatztyp_id;
        this.revision.update((value: number) => value + 1);
      }),
    );
  }

  /**
   * Saves a category from the category dialog. A create appends the row the backend answers; an
   * update replaces the stored row at the same position with the saved values. Both swap the
   * array rather than mutating it, so `categoryPathsById` and `categoryAssignment` recompute.
   * Errors propagate to the caller, and `categories` stays untouched.
   */
  saveCategory(save: CategorySave): Observable<CategoryRow> {
    return saveCategoryInto(this.api, this.categories, save);
  }

  /**
   * Assigns one category (or none, when `umsatztypId` is null) to several stored transactions in a
   * single request. Each item carries the row's current `kommentar` and `umsatztyp_id` as
   * `expected`, so a stale row makes the backend answer `409`. On success every row is mutated in
   * place and `revision` is bumped once, like `saveTransaction`. Errors propagate, and the rows
   * stay untouched.
   */
  assignCategory(rows: readonly TransactionRow[], umsatztypId: number | null): Observable<void> {
    if (rows.length === 0) throw new Error('assignCategory needs at least one transaction');
    const items: TransactionAssignItem[] = rows.map(
      (row: TransactionRow): TransactionAssignItem => ({
        id: row.id,
        expected: { kommentar: row.kommentar, umsatztyp_id: row.umsatztyp_id },
      }),
    );
    const request: TransactionAssignRequest = { items, umsatztyp_id: umsatztypId };
    return this.api.assignCategory(request).pipe(
      tap((): void => {
        for (const row of rows) row.umsatztyp_id = umsatztypId;
        this.revision.update((value: number) => value + 1);
      }),
    );
  }

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
