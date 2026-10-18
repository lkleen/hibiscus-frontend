import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type {
  TransactionAssignRequest,
  TransactionRow,
  TransactionUpdateRequest,
  TransactionsResponse,
} from '@hibiscus-frontend/shared/contracts/transactions';
import type {
  DatePresetList,
  TableDensities,
} from '@hibiscus-frontend/shared/contracts/user-settings';
import type {
  CategoryCreateRequest,
  CategoryEditableFields,
  CategoryRow,
  CategoryUpdateRequest,
} from '@hibiscus-frontend/shared/contracts/categories';
import { categoryRow } from '../utils/testing/category-row-fixture';
import {
  transaction,
  transactionsResponse,
} from '../../features/transactions/testing/transaction-fixture';
import { ApiService, toTransactionRows } from './api.service';

describe('ApiService', () => {
  let service: ApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('requests /api/me', () => {
    service.getMe().subscribe();

    const req = httpMock.expectOne('/api/me');
    expect(req.request.method).toBe('GET');
    req.flush({ user: 'lars@kleen.email' });
  });

  it('requests /api/accounts', () => {
    service.getAccounts().subscribe();

    const req = httpMock.expectOne('/api/accounts');
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('requests every transaction at once, without paging or filter params', () => {
    service.getTransactions().subscribe();

    const req = httpMock.expectOne('/api/transactions');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.keys()).toEqual([]);
    req.flush({ columns: [], rows: [] });
  });

  it('decodes the columnar transactions payload into raw rows', () => {
    const rows: TransactionRow[] = [transaction({ id: 1, zweck: 'A' }), transaction({ id: 2 })];
    let received: TransactionRow[] = [];
    service.getTransactions().subscribe((result: TransactionRow[]) => (received = result));

    httpMock.expectOne('/api/transactions').flush(transactionsResponse(rows));

    expect(received).toEqual(rows);
  });

  it('rejects a transaction row whose length does not match the columns', () => {
    const response: TransactionsResponse = { columns: ['id', 'konto_id'], rows: [[1]] };

    expect(() => toTransactionRows(response)).toThrow(/1 values for 2 columns/);
  });

  it('patches one transaction with the expected and next values', () => {
    const request: TransactionUpdateRequest = {
      expected: { kommentar: null, umsatztyp_id: 3 },
      next: { kommentar: 'Groceries', umsatztyp_id: null },
    };
    service.updateTransaction(42, request).subscribe();

    const req = httpMock.expectOne('/api/transactions/42');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual(request);
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('posts the bulk category assignment', () => {
    const request: TransactionAssignRequest = {
      items: [
        { id: 1, expected: { kommentar: null, umsatztyp_id: 3 } },
        { id: 2, expected: { kommentar: 'Rent', umsatztyp_id: null } },
      ],
      umsatztyp_id: 7,
    };
    service.assignCategory(request).subscribe();

    const req = httpMock.expectOne('/api/transactions/assign-category');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(request);
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('posts a new category and answers the stored row', () => {
    const request: CategoryCreateRequest = {
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
    const stored: CategoryRow = categoryRow({ id: 9, name: 'Rent', pattern: 'rent', umsatztyp: 0 });
    let received: CategoryRow | undefined = undefined;
    service.createCategory(request).subscribe((row: CategoryRow) => (received = row));

    const req = httpMock.expectOne('/api/categories');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(request);
    req.flush(stored, { status: 201, statusText: 'Created' });

    expect(received).toEqual(stored);
  });

  it('puts one category with the expected and next values', () => {
    const expected: CategoryEditableFields = {
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
    const request: CategoryUpdateRequest = {
      expected,
      next: { ...expected, name: 'Housing', parent_id: 3 },
    };
    service.updateCategory(9, request).subscribe();

    const req = httpMock.expectOne('/api/categories/9');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual(request);
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('requests the table densities', () => {
    service.getTableDensities().subscribe();

    const req = httpMock.expectOne('/api/settings/table-densities');
    expect(req.request.method).toBe('GET');
    req.flush({});
  });

  it('puts the whole table density map as JSON', () => {
    const densities: TableDensities = { categories: 'compact' };
    service.saveTableDensities(densities).subscribe();

    const req = httpMock.expectOne('/api/settings/table-densities');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual(densities);
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('requests the date presets', () => {
    service.getDatePresets().subscribe();

    const req = httpMock.expectOne('/api/settings/date-presets');
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('puts the whole date preset list', () => {
    const presets: DatePresetList = [
      { id: 'a', name: null, kind: 'relative', unit: 'month', offset: 0, count: 1 },
    ];
    service.saveDatePresets(presets).subscribe();

    const req = httpMock.expectOne('/api/settings/date-presets');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual(presets);
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('deletes the stored date presets', () => {
    service.resetDatePresets().subscribe();

    const req = httpMock.expectOne('/api/settings/date-presets');
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
  });
});
