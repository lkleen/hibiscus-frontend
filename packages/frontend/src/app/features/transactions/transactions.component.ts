import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import { Table, TableModule } from 'primeng/table';
import { Category } from '../../core/models/category.model';
import { ApiService } from '../../core/services/api.service';
import { TranslationService } from '../../core/services/translation.service';
import { AmountCellComponent } from './cells/amount-cell/amount-cell.component';
import { CategoryCellComponent } from './cells/category-cell/category-cell.component';

/** Rows per table page. */
const PAGE_SIZE = 20;

/** Options for `p-table`'s own rows-per-page dropdown (ARIA-labelled, no visible text label). */
const ROWS_PER_PAGE_OPTIONS = [10, 20, 50, 100];

/**
 * The `umsatz` row plus the values PrimeNG needs as plain properties to sort, filter and
 * quick-search on them — it has no `valueGetter` equivalent, so a looked-up value must be a real
 * field on the bound row. Every raw `TransactionRow` field is unchanged; these are *attached*
 * lookups, not rewrites (skill §2 — columns are still displayed exactly as stored):
 * - the account's own columns, looked up by `konto_id`;
 * - the category name, looked up by `umsatztyp_id`;
 * - `datum_date`/`valuta_date`, real `Date`s for the two date columns. Filter-only — display and
 *   sort keep the raw ISO strings (`datum`/`valuta`, lexicographic order is already chronological).
 *   PrimeNG's date filter renders a datepicker and emits a `Date`, and `FilterService` then calls
 *   `.toDateString()` on the cell value, which throws on a string.
 */
export interface TransactionViewRow extends TransactionRow {
  readonly konto_name: string | null;
  readonly konto_bic: string | null;
  readonly konto_kontonummer: string | null;
  readonly konto_bezeichnung: string | null;
  // Not `readonly`, unlike the other lookups here: `applyCategory` mutates this field (and
  // `umsatztyp_id`, already mutable — it isn't `readonly` on `TransactionRow`, so it needs no
  // redeclaration) on the existing row object, never a replacement object, after a successful
  // PATCH. PrimeNG's `filteredValue` — what an active filter actually renders — holds the *same
  // object references* as `rows()`, not copies, so an in-place field mutation is the only way the
  // change is visible while filtered; replacing the object at `rows()[i]` would update `rows()`
  // but leave the stale object sitting in `filteredValue`.
  category_name: string | null;
  readonly datum_date: Date | null;
  readonly valuta_date: Date | null;
}

/**
 * Parses a `YYYY-MM-DD` string as a *local* midnight `Date`, matching what the date filter's own
 * datepicker produces for the same calendar day. A plain `new Date(isoString)` parses a date-only
 * ISO string as UTC, which shifts a day in negative-offset timezones. `null` if the value doesn't
 * parse — this only feeds the column filters, never display or sort.
 */
function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

function buildViewRow(
  row: TransactionRow,
  accounts: ReadonlyMap<number, AccountRow>,
  categories: ReadonlyMap<number, Category>,
): TransactionViewRow {
  const account = accounts.get(row.konto_id);
  const category = row.umsatztyp_id === null ? undefined : categories.get(row.umsatztyp_id);
  return {
    ...row,
    konto_name: account?.name ?? null,
    konto_bic: account?.bic ?? null,
    konto_kontonummer: account?.kontonummer ?? null,
    konto_bezeichnung: account?.bezeichnung ?? null,
    category_name: category?.name ?? null,
    datum_date: parseIsoDate(row.datum),
    valuta_date: parseIsoDate(row.valuta),
  };
}

/**
 * The transactions table. The API serves every `umsatz` row as stored, all of them in one
 * request; sorting, filtering (column filters and the global filter) and paging are PrimeNG's, on
 * the loaded rows. See the `transactions-table` skill.
 */
@Component({
  selector: 'app-transactions',
  templateUrl: './transactions.component.html',
  styleUrl: './transactions.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TableModule, AmountCellComponent, CategoryCellComponent],
})
export class TransactionsComponent {
  private readonly api = inject(ApiService);
  protected readonly i18n = inject(TranslationService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly cdr = inject(ChangeDetectorRef);

  protected readonly pageSize = PAGE_SIZE;
  protected readonly rowsPerPageOptions = ROWS_PER_PAGE_OPTIONS;

  // Newest booking first, with the id tie-break the old grid had (both `initialSort`s there).
  protected readonly defaultSortMeta = [
    { field: 'datum', order: -1 },
    { field: 'id', order: -1 },
  ];

  // Every displayed field, including the looked-up ones — `globalFilterFields` only resolves
  // own/nested properties and throws if a listed one is absent from the row.
  protected readonly globalFilterFields: string[] = [
    'datum',
    'valuta',
    'konto_name',
    'konto_bic',
    'konto_kontonummer',
    'konto_bezeichnung',
    'empfaenger_name',
    'empfaenger_konto',
    'empfaenger_blz',
    'zweck',
    'zweck2',
    'zweck3',
    'art',
    'gvcode',
    'endtoendid',
    'betrag',
    'saldo',
    'category_name',
  ];

  protected readonly accounts = signal<AccountRow[]>([]);
  protected readonly categories = signal<Category[]>([]);
  /** Fed to the table's global filter, which matches every field in `globalFilterFields`. */
  protected readonly q = signal('');

  private readonly items = signal<TransactionRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);
  protected readonly categoryUpdateErrorId = signal<number | null>(null);

  // `TranslationService.t()` throws on any `{word}` left in the template that isn't in `params`.
  // The literal `{first}`/`{last}`/`{totalRecords}` tokens must survive substitution unchanged —
  // PrimeNG's own paginator replaces them later — so passing each back as its own token satisfies
  // `t()`'s placeholder check without touching the token. Same trick as `aria.pageLabel` in
  // `core/utils/primeng-translation.ts`.
  protected readonly pageReportTemplate = computed<string>(() =>
    this.i18n.t('transactions.pageReport', {
      first: '{first}',
      last: '{last}',
      totalRecords: '{totalRecords}',
    }),
  );

  private readonly accountsById = computed(
    () => new Map(this.accounts().map((account) => [account.id, account])),
  );
  private readonly categoriesById = computed(
    () => new Map(this.categories().map((category) => [category.id, category])),
  );

  // A plain signal, not a `computed`: `applyCategory` mutates this array's contents in place, so
  // the array bound to `[value]` keeps its identity. PrimeNG resets the table to page 1 whenever
  // that identity changes while a filter is active (`_filter()` sets `first = 0`), which a
  // `computed` would trigger on every rebuild — a `computed` can't be mutated from the outside,
  // so the category update would have to go through `items` instead, producing a new array.
  protected readonly rows = signal<TransactionViewRow[]>([]);

  protected readonly table = viewChild<Table<TransactionViewRow>>('dt');

  constructor() {
    // Rebuilds the full row set whenever a source signal loads. In practice this runs once per
    // signal at startup (accounts, categories and items each load once) and never fights the
    // in-place mutation `applyCategory` does for a single row afterwards.
    effect(() => {
      const accounts = this.accountsById();
      const categories = this.categoriesById();
      const items = this.items();
      this.rows.set(items.map((item) => buildViewRow(item, accounts, categories)));
    });

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

  /** Empty text cells show a dash, like the other tables in the app. */
  protected dash(value: string | null | undefined): string {
    return value === null || value === undefined || value.trim() === '' ? '—' : value;
  }

  protected onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.q.set(value);
    this.table()?.filterGlobal(value, 'contains');
  }

  protected onCategoryChange(transactionId: number, categoryId: number | null): void {
    this.categoryUpdateErrorId.set(null);
    this.api
      .updateTransactionCategory(transactionId, { categoryId })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.applyCategory(transactionId, categoryId),
        error: () => this.categoryUpdateErrorId.set(transactionId),
      });
  }

  // The backend answers 204, so the change is applied to the row the table holds. Mutating the
  // row's fields in place — rather than replacing `rows()[index]` with a new object — matters for
  // two separate reasons: it keeps `rows()`'s array identity (the user's page, sorting and
  // filters survive, per the comment on `rows` above), and it keeps the *row object's* identity,
  // which PrimeNG's `filteredValue` needs: while a filter is active, the table renders
  // `filteredValue`, a separate array holding the same row references as `rows()`; replacing the
  // object would update `rows()` but leave the stale object sitting in `filteredValue`.
  private applyCategory(transactionId: number, categoryId: number | null): void {
    const rows = this.rows();
    const index = rows.findIndex((row) => row.id === transactionId);
    if (index === -1) throw new Error(`transaction ${transactionId} is not in the table`);
    const categoryName =
      categoryId === null ? null : (this.categoriesById().get(categoryId)?.name ?? null);
    const row = rows[index];
    row.umsatztyp_id = categoryId;
    row.category_name = categoryName;
    this.cdr.markForCheck();
  }
}
