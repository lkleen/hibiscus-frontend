import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type {
  CategoryEditableFields,
  CategoryRow,
} from '@hibiscus-frontend/shared/contracts/categories';
import { categoryRow } from '../../core/utils/testing/category-row-fixture';
import {
  account,
  transaction,
  transactionsResponse,
} from '../transactions/testing/transaction-fixture';
import { CategoriesStore } from './categories.store';
import type { CategorySave } from './edit-dialog/category-edit-dialog.model';

describe('CategoriesStore', () => {
  let httpMock: HttpTestingController;
  let store: CategoriesStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), CategoriesStore],
    });
    httpMock = TestBed.inject(HttpTestingController);
    store = TestBed.inject(CategoriesStore);
  });

  afterEach(() => {
    httpMock.verify();
  });

  function load(accounts: AccountRow[], categories: CategoryRow[]): void {
    httpMock.expectOne('/api/accounts').flush(accounts);
    httpMock.expectOne('/api/categories').flush(categories);
    httpMock.expectOne('/api/transactions').flush(transactionsResponse([transaction({ id: 1 })]));
  }

  const fields: CategoryEditableFields = {
    name: 'Rent',
    nummer: null,
    pattern: 'rent',
    isregex: 0,
    umsatztyp: 0,
    parent_id: null,
    color: null,
    customcolor: null,
    kommentar: null,
    konto_id: null,
    konto_kategorie: null,
    flags: null,
  };

  it('loads accounts, categories and transactions once', () => {
    expect(store.loading()).toBe(true);
    load([account({ id: 1 })], [categoryRow({ id: 1 })]);

    expect(store.loading()).toBe(false);
    expect(store.accounts().length).toBe(1);
    expect(store.categories().length).toBe(1);
    expect(store.transactions().length).toBe(1);
    expect(store.accountsById().get(1)?.id).toBe(1);
  });

  it('flags an error when a request fails', () => {
    httpMock.expectOne('/api/accounts').flush([]);
    httpMock.expectOne('/api/transactions').flush(transactionsResponse([]));
    httpMock.expectOne('/api/categories').flush('x', { status: 500, statusText: 'err' });

    expect(store.error()).toBe(true);
    expect(store.loading()).toBe(false);
  });

  it('derives the root-to-leaf category paths', () => {
    load(
      [],
      [
        categoryRow({ id: 1, name: 'Living' }),
        categoryRow({ id: 2, name: 'Housing', parent_id: 1 }),
      ],
    );

    expect(store.categoryPathsById().get(2)).toBe('Living / Housing');
  });

  it('posts a create and appends the stored row', () => {
    load([], [categoryRow({ id: 1 })]);
    const save: CategorySave = { kind: 'create', fields };
    let received: CategoryRow | undefined = undefined;
    store.saveCategory(save).subscribe((row: CategoryRow) => (received = row));

    httpMock
      .expectOne('/api/categories')
      .flush(categoryRow({ id: 5, name: 'Rent' }), { status: 201, statusText: 'Created' });

    expect(received).toEqual(categoryRow({ id: 5, name: 'Rent' }));
    expect(store.categories().map((row: CategoryRow) => row.id)).toEqual([1, 5]);
  });

  it('puts an update with the starting values as expected and replaces the row in place', () => {
    const original: CategoryRow = { id: 2, ...fields, name: 'Old' };
    load([], [categoryRow({ id: 1 }), original, categoryRow({ id: 3 })]);
    const save: CategorySave = {
      kind: 'update',
      category: original,
      next: { ...fields, name: 'New' },
    };

    store.saveCategory(save).subscribe();

    const req = httpMock.expectOne('/api/categories/2');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({
      expected: { ...fields, name: 'Old' },
      next: { ...fields, name: 'New' },
    });
    req.flush(null, { status: 204, statusText: 'No Content' });

    expect(store.categories()).toEqual([
      categoryRow({ id: 1 }),
      { id: 2, ...fields, name: 'New' },
      categoryRow({ id: 3 }),
    ]);
  });

  it('leaves the categories untouched when a save fails', () => {
    const original: CategoryRow = { id: 2, ...fields, name: 'Old' };
    load([], [original]);
    const before: readonly CategoryRow[] = store.categories();
    let failure: unknown = null;

    store
      .saveCategory({ kind: 'update', category: original, next: { ...fields, parent_id: 2 } })
      .subscribe({ error: (error: unknown) => (failure = error) });
    httpMock
      .expectOne('/api/categories/2')
      .flush({ error: 'cycle' }, { status: 400, statusText: 'Bad Request' });

    expect(failure).not.toBeNull();
    expect(store.categories()).toBe(before);
  });
});
