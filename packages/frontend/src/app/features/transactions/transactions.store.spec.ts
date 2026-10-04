import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
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
});
