import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type {
  TransactionRow,
  TransactionsResponse,
} from '@hibiscus-frontend/shared/contracts/transactions';
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

  it('PATCHes a transaction category', () => {
    service.updateTransactionCategory(42, { categoryId: 7 }).subscribe();

    const req = httpMock.expectOne('/api/transactions/42');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ categoryId: 7 });
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('POSTs a new category', () => {
    service.createCategory({ name: 'Groceries', parentId: null, color: '#2f6f4f' }).subscribe();

    const req = httpMock.expectOne('/api/categories');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ name: 'Groceries', parentId: null, color: '#2f6f4f' });
    req.flush({ id: 1, name: 'Groceries', parentId: null, color: '#2f6f4f' });
  });

  it('DELETEs a category', () => {
    service.deleteCategory(9).subscribe();

    const req = httpMock.expectOne('/api/categories/9');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });

  it('requests /api/payees with an optional search term', () => {
    service.getPayees('acme').subscribe();

    const req = httpMock.expectOne((r) => r.url === '/api/payees');
    expect(req.request.params.get('q')).toBe('acme');
    req.flush([]);
  });
});
