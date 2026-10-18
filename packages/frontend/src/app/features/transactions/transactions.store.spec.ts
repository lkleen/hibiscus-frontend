import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type {
  CategoryEditableFields,
  CategoryRow,
} from '@hibiscus-frontend/shared/contracts/categories';
import type {
  TransactionEditableFields,
  TransactionRow,
} from '@hibiscus-frontend/shared/contracts/transactions';
import { categoryRow } from '../../core/utils/testing/category-row-fixture';
import { account, transaction, transactionsResponse } from './testing/transaction-fixture';
import { TransactionsStore } from './transactions.store';

describe('TransactionsStore', () => {
  let httpMock: HttpTestingController;
  let store: TransactionsStore;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), TransactionsStore],
    });
    httpMock = TestBed.inject(HttpTestingController);
    store = TestBed.inject(TransactionsStore);
  });

  afterEach(() => {
    httpMock.verify();
    vi.useRealTimers();
  });

  function load(accounts: AccountRow[], rows: TransactionRow[]): void {
    httpMock.expectOne('/api/accounts').flush(accounts);
    httpMock.expectOne('/api/transactions').flush(transactionsResponse(rows));
    httpMock.expectOne('/api/categories').flush([]);
  }

  /** Types into the search field and lets the debounce elapse. */
  function search(text: string): void {
    store.searchInput.set(text);
    TestBed.tick();
    vi.advanceTimersByTime(300);
  }

  it('fetches accounts, transactions and categories exactly once', () => {
    expect(store.loading()).toBe(true);
    load([account({ id: 1 })], [transaction({ id: 1 })]);

    expect(store.loading()).toBe(false);
    expect(store.accounts().length).toBe(1);
    expect(store.transactions().length).toBe(1);
    expect(store.accountsById().get(1)?.id).toBe(1);
  });

  it('flags an error when a request fails', () => {
    httpMock.expectOne('/api/accounts').flush([]);
    httpMock.expectOne('/api/categories').flush([]);
    httpMock.expectOne('/api/transactions').flush('x', { status: 500, statusText: 'err' });

    expect(store.error()).toBe(true);
    expect(store.loading()).toBe(false);
  });

  it('has no row filter while nothing restricts', () => {
    load([], [transaction()]);

    expect(store.rowFilter()).toBeNull();
    expect(store.filteredTransactions()).toBe(store.transactions());
  });

  it('filters by excluded account and date range', () => {
    load(
      [],
      [
        transaction({ id: 1, konto_id: 1, datum: '2026-01-10' }),
        transaction({ id: 2, konto_id: 2, datum: '2026-01-20' }),
        transaction({ id: 3, konto_id: 1, datum: '2026-03-01' }),
      ],
    );

    store.excludedAccountIds.set(new Set([2]));
    expect(store.filteredTransactions().map((row) => row.id)).toEqual([1, 3]);

    store.range.set({ from: '2026-01-01', to: '2026-01-31' });
    expect(store.filteredTransactions().map((row) => row.id)).toEqual([1]);
  });

  it('applies the search only after the debounce, over the table columns', () => {
    load(
      [account({ id: 1, bezeichnung: 'Checking' })],
      [
        transaction({ id: 1, zweck: 'rent' }),
        transaction({ id: 2, zweck: 'groceries' }),
        transaction({ id: 3, konto_id: 1, zweck3: 'RENT garage' }),
      ],
    );

    store.searchInput.set('rent');
    TestBed.tick();
    vi.advanceTimersByTime(299);
    expect(store.search()).toBe('');
    expect(store.rowFilter()).toBeNull();

    vi.advanceTimersByTime(1);
    expect(store.search()).toBe('rent');
    expect(store.filteredTransactions().map((row) => row.id)).toEqual([1, 3]);

    search('checking');
    expect(store.filteredTransactions().map((row) => row.id)).toEqual([1, 2, 3]);
  });

  it('assigns categories over all transactions, ignoring the filters', () => {
    httpMock.expectOne('/api/accounts').flush([account({ id: 1 })]);
    httpMock
      .expectOne('/api/transactions')
      .flush(
        transactionsResponse([
          transaction({ id: 1, zweck: 'rent', datum: '2026-01-10' }),
          transaction({ id: 2, zweck: 'other', datum: '2026-03-10' }),
        ]),
      );
    httpMock
      .expectOne('/api/categories')
      .flush([categoryRow({ id: 7, name: 'Housing', pattern: 'rent', konto_kategorie: null })]);

    store.range.set({ from: '2026-03-01', to: '2026-03-31' });
    expect(store.filteredTransactions().length).toBe(1);
    expect(store.categoryAssignment().byTransactionId.get(1)?.id).toBe(7);
    expect(store.categoryAssignment().byTransactionId.get(2)).toBeNull();
  });

  it('treats a blank search as no filter', () => {
    load([], [transaction()]);
    search('   ');

    expect(store.rowFilter()).toBeNull();
  });

  /** The first loaded row; the store's row objects are the ones an edit mutates. */
  function firstRow(): TransactionRow {
    const row: TransactionRow | undefined = store.transactions()[0];
    if (!row) throw new Error('no transaction loaded');
    return row;
  }

  /** Starts a save and answers its PATCH with `204`. */
  function save(row: TransactionRow, next: TransactionEditableFields): void {
    store.saveTransaction(row, next).subscribe();
    httpMock
      .expectOne(`/api/transactions/${row.id}`)
      .flush(null, { status: 204, statusText: 'No Content' });
  }

  it('sends the starting values as expected and the edit as next', () => {
    load([], [transaction({ id: 1, kommentar: 'old', umsatztyp_id: 7 })]);
    const row: TransactionRow = firstRow();

    store.saveTransaction(row, { kommentar: 'new', umsatztyp_id: null }).subscribe();

    const req = httpMock.expectOne('/api/transactions/1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({
      expected: { kommentar: 'old', umsatztyp_id: 7 },
      next: { kommentar: 'new', umsatztyp_id: null },
    });
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('mutates the stored row in place and bumps the revision on success', () => {
    load([], [transaction({ id: 1, kommentar: null, umsatztyp_id: null })]);
    const row: TransactionRow = firstRow();

    save(row, { kommentar: 'Groceries', umsatztyp_id: 8 });

    expect(firstRow()).toBe(row);
    expect(row.kommentar).toBe('Groceries');
    expect(row.umsatztyp_id).toBe(8);
    expect(store.revision()).toBe(1);
  });

  it('recomputes the category assignment after a saved edit', () => {
    httpMock.expectOne('/api/accounts').flush([account({ id: 1 })]);
    httpMock
      .expectOne('/api/transactions')
      .flush(transactionsResponse([transaction({ id: 1, zweck: 'rent', umsatztyp_id: null })]));
    httpMock
      .expectOne('/api/categories')
      .flush([
        categoryRow({ id: 7, name: 'Housing', pattern: 'rent', konto_kategorie: null }),
        categoryRow({ id: 8, name: 'Food', pattern: 'groceries', konto_kategorie: null }),
      ]);
    expect(store.categoryAssignment().byTransactionId.get(1)?.id).toBe(7);

    save(firstRow(), { kommentar: null, umsatztyp_id: 8 });

    expect(store.categoryAssignment().byTransactionId.get(1)?.id).toBe(8);
  });

  it('keeps the row filter instance when an edit bumps the revision', () => {
    load([], [transaction({ id: 1 })]);
    store.range.set({ from: '2026-01-01', to: '2026-12-31' });
    const filter: ReturnType<typeof store.rowFilter> = store.rowFilter();

    save(firstRow(), { kommentar: 'edited', umsatztyp_id: null });

    expect(store.rowFilter()).toBe(filter);
  });

  /** Starts a bulk assign and answers its POST with `204`. */
  function assign(rows: TransactionRow[], umsatztypId: number | null): void {
    store.assignCategory(rows, umsatztypId).subscribe();
    httpMock
      .expectOne('/api/transactions/assign-category')
      .flush(null, { status: 204, statusText: 'No Content' });
  }

  it('posts the starting values of every row as expected, with the category as target', () => {
    load(
      [],
      [
        transaction({ id: 1, kommentar: 'old', umsatztyp_id: 7 }),
        transaction({ id: 2, kommentar: null, umsatztyp_id: null }),
      ],
    );
    const rows: TransactionRow[] = store.transactions().slice();

    store.assignCategory(rows, 8).subscribe();

    const req = httpMock.expectOne('/api/transactions/assign-category');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      items: [
        { id: 1, expected: { kommentar: 'old', umsatztyp_id: 7 } },
        { id: 2, expected: { kommentar: null, umsatztyp_id: null } },
      ],
      umsatztyp_id: 8,
    });
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('mutates every assigned row in place and bumps the revision exactly once', () => {
    load(
      [],
      [
        transaction({ id: 1, umsatztyp_id: 7 }),
        transaction({ id: 2, umsatztyp_id: null }),
        transaction({ id: 3, umsatztyp_id: 9 }),
      ],
    );
    const rows: TransactionRow[] = store.transactions().slice(0, 2);

    assign(rows, 8);

    expect(store.transactions()[0]).toBe(rows[0]);
    expect(store.transactions()[1]).toBe(rows[1]);
    expect(rows.map((row: TransactionRow) => row.umsatztyp_id)).toEqual([8, 8]);
    expect(store.transactions()[2]?.umsatztyp_id).toBe(9);
    expect(store.revision()).toBe(1);
  });

  it('clears the category of every assigned row when given null', () => {
    load([], [transaction({ id: 1, umsatztyp_id: 7 }), transaction({ id: 2, umsatztyp_id: 8 })]);

    assign(store.transactions().slice(), null);

    expect(store.transactions().map((row: TransactionRow) => row.umsatztyp_id)).toEqual([
      null,
      null,
    ]);
    expect(store.revision()).toBe(1);
  });

  it('recomputes the category assignment after a bulk assign', () => {
    httpMock.expectOne('/api/accounts').flush([account({ id: 1 })]);
    httpMock
      .expectOne('/api/transactions')
      .flush(
        transactionsResponse([
          transaction({ id: 1, zweck: 'rent', umsatztyp_id: null }),
          transaction({ id: 2, zweck: 'other', umsatztyp_id: null }),
        ]),
      );
    httpMock
      .expectOne('/api/categories')
      .flush([
        categoryRow({ id: 7, name: 'Housing', pattern: 'rent', konto_kategorie: null }),
        categoryRow({ id: 8, name: 'Food', pattern: 'groceries', konto_kategorie: null }),
      ]);
    expect(store.categoryAssignment().byTransactionId.get(1)?.id).toBe(7);

    assign(store.transactions().slice(), 8);

    expect(store.categoryAssignment().byTransactionId.get(1)?.id).toBe(8);
    expect(store.categoryAssignment().byTransactionId.get(2)?.id).toBe(8);
  });

  it('throws when no rows are given, without sending a request', () => {
    load([], [transaction({ id: 1 })]);

    expect(() => store.assignCategory([], 8)).toThrow();
  });

  it('leaves the rows and the revision untouched when the bulk assign conflicts', () => {
    load([], [transaction({ id: 1, umsatztyp_id: 7 }), transaction({ id: 2, umsatztyp_id: null })]);
    const rows: TransactionRow[] = store.transactions().slice();
    let failure: unknown = null;

    store.assignCategory(rows, 8).subscribe({
      error: (error: unknown) => (failure = error),
    });
    httpMock
      .expectOne('/api/transactions/assign-category')
      .flush({ error: 'conflict', conflictIds: [2] }, { status: 409, statusText: 'Conflict' });

    expect(failure).not.toBeNull();
    expect(rows.map((row: TransactionRow) => row.umsatztyp_id)).toEqual([7, null]);
    expect(store.revision()).toBe(0);
  });

  it('leaves the row and the revision untouched when the save fails', () => {
    load([], [transaction({ id: 1, kommentar: 'old', umsatztyp_id: 7 })]);
    const row: TransactionRow = firstRow();
    let failure: unknown = null;

    store.saveTransaction(row, { kommentar: 'new', umsatztyp_id: null }).subscribe({
      error: (error: unknown) => (failure = error),
    });
    httpMock
      .expectOne('/api/transactions/1')
      .flush('changed elsewhere', { status: 409, statusText: 'Conflict' });

    expect(failure).not.toBeNull();
    expect(row.kommentar).toBe('old');
    expect(row.umsatztyp_id).toBe(7);
    expect(store.revision()).toBe(0);
  });

  /** Loads the store with the given categories and no transactions. */
  function loadCategories(categories: CategoryRow[]): void {
    httpMock.expectOne('/api/accounts').flush([]);
    httpMock.expectOne('/api/transactions').flush(transactionsResponse([]));
    httpMock.expectOne('/api/categories').flush(categories);
  }

  it('posts a new category and appends the row the backend answers', () => {
    loadCategories([categoryRow({ id: 7, name: 'Housing' })]);
    const { id, ...editable }: CategoryRow = categoryRow({ name: 'Food' });
    let created: CategoryRow | null = null;

    store
      .saveCategory({ kind: 'create', fields: editable })
      .subscribe((row: CategoryRow) => (created = row));
    const req = httpMock.expectOne('/api/categories');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(editable);
    req.flush(categoryRow({ id: 9, name: 'Food' }), { status: 201, statusText: 'Created' });

    expect(id).toBe(1);
    expect(created).toEqual(categoryRow({ id: 9, name: 'Food' }));
    expect(store.categories().map((row: CategoryRow) => row.id)).toEqual([7, 9]);
  });

  it('puts an edit with the starting values as expected and replaces the row in place', () => {
    const housing: CategoryRow = categoryRow({ id: 7, name: 'Housing', pattern: 'rent' });
    loadCategories([housing, categoryRow({ id: 8, name: 'Food' })]);
    const { id, ...expected }: CategoryRow = housing;
    const next: CategoryEditableFields = { ...expected, name: 'Rent', pattern: 'miete' };

    store.saveCategory({ kind: 'update', category: housing, next }).subscribe();
    const req = httpMock.expectOne('/api/categories/7');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ expected, next });
    req.flush(null, { status: 204, statusText: 'No Content' });

    expect(id).toBe(7);
    expect(store.categories().map((row: CategoryRow) => row.id)).toEqual([7, 8]);
    expect(store.categories()[0]).toEqual({ id: 7, ...next });
    expect(store.categories()[0]).not.toBe(housing);
  });

  it('leaves the categories untouched when the save fails', () => {
    const housing: CategoryRow = categoryRow({ id: 7, name: 'Housing' });
    loadCategories([housing]);
    const before: readonly CategoryRow[] = store.categories();
    const { id, ...expected }: CategoryRow = housing;
    let failure: unknown = null;

    store
      .saveCategory({ kind: 'update', category: housing, next: { ...expected, name: 'Rent' } })
      .subscribe({ error: (error: unknown) => (failure = error) });
    httpMock
      .expectOne('/api/categories/7')
      .flush('changed elsewhere', { status: 409, statusText: 'Conflict' });

    expect(id).toBe(7);
    expect(failure).not.toBeNull();
    expect(store.categories()).toBe(before);
    expect(store.categories()[0]?.name).toBe('Housing');
  });
});
