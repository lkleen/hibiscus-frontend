import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import type {
  Transaction,
  TransactionsQuery,
} from '@hibiscus-frontend/shared/contracts/transactions';
import type {
  ColDef,
  GetRowIdParams,
  GridApi,
  GridReadyEvent,
  RowDataUpdatedEvent,
  ValueFormatterParams,
  ValueGetterParams,
} from 'ag-grid-community';
import { catchError, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { BaseTableComponent } from '../../core/components/base-table/base-table.component';
import { Account } from '../../core/models/account.model';
import { Category } from '../../core/models/category.model';
import { ApiService } from '../../core/services/api.service';
import { TranslationService } from '../../core/services/translation.service';
import { AmountCellComponent } from './cells/amount-cell/amount-cell.component';
import { CategoryCellComponent } from './cells/category-cell/category-cell.component';
import { DescriptionCellComponent } from './cells/description-cell/description-cell.component';
import type { TransactionsGridContext } from './cells/transactions-grid-context';

/** Rows per grid page. */
const PAGE_SIZE = 20;
/**
 * Rows fetched from the API at once. The grid paginates within the loaded chunk; the next chunk is
 * fetched when the user pages past it. A multiple of PAGE_SIZE so a chunk never ends mid-page, and
 * well below the backend's per-response cap.
 */
const CHUNK_SIZE = 500;
const PAGES_PER_CHUNK = CHUNK_SIZE / PAGE_SIZE;

function sameQuery(a: TransactionsQuery, b: TransactionsQuery): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function requireRow(data: Transaction | undefined): Transaction {
  if (!data) throw new Error('transactions grid row has no data');
  return data;
}

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

  protected readonly accounts = signal<Account[]>([]);
  protected readonly categories = signal<Category[]>([]);

  protected readonly accountId = signal<number | null>(null);
  protected readonly from = signal('');
  protected readonly to = signal('');
  protected readonly categoryId = signal<number | null>(null);
  protected readonly q = signal('');
  /** 1-based page over the whole result, not over the loaded chunk. */
  protected readonly page = signal(1);

  protected readonly items = signal<Transaction[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);
  protected readonly categoryUpdateErrorId = signal<number | null>(null);

  protected readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));
  protected readonly accountsById = computed(
    () => new Map(this.accounts().map((account) => [account.id, account])),
  );

  private readonly chunk = computed(() => Math.floor((this.page() - 1) / PAGES_PER_CHUNK));
  private readonly pageInChunk = computed(() => (this.page() - 1) % PAGES_PER_CHUNK);

  // Depends on the chunk, not the page: paging inside a loaded chunk must not refetch.
  private readonly query = computed<TransactionsQuery>(() => ({
    accountId: this.accountId() ?? undefined,
    from: this.from() || undefined,
    to: this.to() || undefined,
    categoryId: this.categoryId() ?? undefined,
    q: this.q() || undefined,
    limit: CHUNK_SIZE,
    offset: this.chunk() * CHUNK_SIZE,
  }));

  private readonly gridApi = signal<GridApi<Transaction> | undefined>(undefined);

  protected readonly gridContext: TransactionsGridContext = {
    categories: this.categories,
    categoryUpdateErrorId: this.categoryUpdateErrorId,
    changeCategory: (transactionId, categoryId) => this.onCategoryChange(transactionId, categoryId),
  };

  protected readonly defaultColDef: ColDef<Transaction> = {
    // Only one chunk of the result is loaded, so sorting or filtering in the grid would mislead;
    // ordering and filtering are the API's job.
    sortable: false,
    resizable: false,
    suppressMovable: true,
    suppressHeaderMenuButton: true,
  };

  // Header labels come from the translations, never from the (German, DB-mirroring) field names.
  protected readonly columnDefs = computed<ColDef<Transaction>[]>(() => {
    const accounts: Map<number, Account> = this.accountsById();
    return [
      {
        field: 'datum',
        headerName: this.i18n.t('transactions.colDate'),
        minWidth: 110,
        maxWidth: 130,
        // The API sends ISO strings; taking the date part avoids any timezone conversion.
        valueFormatter: (params: ValueFormatterParams<Transaction, string>): string => {
          if (params.value === null || params.value === undefined) {
            throw new Error('transaction without datum');
          }
          return params.value.slice(0, 10);
        },
      },
      {
        headerName: this.i18n.t('transactions.colAccount'),
        flex: 1,
        minWidth: 140,
        valueGetter: (params: ValueGetterParams<Transaction>): string =>
          accounts.get(requireRow(params.data).kontoId)?.name ?? '—',
      },
      {
        headerName: this.i18n.t('transactions.colCounterparty'),
        flex: 3,
        minWidth: 260,
        autoHeight: true,
        cellRenderer: DescriptionCellComponent,
      },
      {
        field: 'betrag',
        headerName: this.i18n.t('transactions.colAmount'),
        type: 'rightAligned',
        flex: 1,
        minWidth: 120,
        cellRenderer: AmountCellComponent,
      },
      {
        field: 'umsatztypId',
        headerName: this.i18n.t('transactions.colCategory'),
        flex: 2,
        minWidth: 180,
        autoHeight: true,
        cellRenderer: CategoryCellComponent,
      },
    ];
  });

  protected readonly localeText = computed<Record<string, string>>(() => ({
    loadingOoo: this.i18n.t('transactions.loading'),
  }));

  protected readonly getRowId = (params: GetRowIdParams<Transaction>): string =>
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

    toObservable(this.query)
      .pipe(
        debounceTime(200),
        distinctUntilChanged(sameQuery),
        switchMap((query) => {
          this.loading.set(true);
          this.error.set(false);
          return this.api.getTransactions(query).pipe(
            catchError(() => {
              this.error.set(true);
              return of({ items: [], total: 0 });
            }),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((response) => {
        this.items.set(response.items);
        this.total.set(response.total);
        this.loading.set(false);
      });

    // Paging inside the loaded chunk: the grid's own pagination does the work.
    effect(() => {
      const api: GridApi<Transaction> | undefined = this.gridApi();
      const target: number = this.pageInChunk();
      api?.paginationGoToPage(target);
    });
  }

  protected onGridReady(event: GridReadyEvent<Transaction>): void {
    this.gridApi.set(event.api);
  }

  // The grid falls back to its first page whenever its row data is replaced (a new chunk, or a row
  // updated after a category change), so restore the page the user is on.
  protected onRowDataUpdated(event: RowDataUpdatedEvent<Transaction>): void {
    event.api.paginationGoToPage(this.pageInChunk());
  }

  protected onAccountChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.accountId.set(value ? Number(value) : null);
    this.page.set(1);
  }

  protected onCategoryFilterChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.categoryId.set(value ? Number(value) : null);
    this.page.set(1);
  }

  protected onFromChange(event: Event): void {
    this.from.set((event.target as HTMLInputElement).value);
    this.page.set(1);
  }

  protected onToChange(event: Event): void {
    this.to.set((event.target as HTMLInputElement).value);
    this.page.set(1);
  }

  protected onSearchInput(event: Event): void {
    this.q.set((event.target as HTMLInputElement).value);
    this.page.set(1);
  }

  protected previousPage(): void {
    this.page.update((p) => Math.max(1, p - 1));
  }

  protected nextPage(): void {
    this.page.update((p) => Math.min(this.totalPages(), p + 1));
  }

  private onCategoryChange(transactionId: number, categoryId: number | null): void {
    this.categoryUpdateErrorId.set(null);
    this.api
      .updateTransactionCategory(transactionId, { categoryId })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        // The backend answers 204, so apply the change to the row we hold. If the user has since
        // moved to another chunk the row is gone and this is a no-op.
        next: () =>
          this.items.update((items) =>
            items.map((t) => (t.id === transactionId ? { ...t, umsatztypId: categoryId } : t)),
          ),
        error: () => this.categoryUpdateErrorId.set(transactionId),
      });
  }
}
