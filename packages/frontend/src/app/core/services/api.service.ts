import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { CreateCategory, Category, UpdateCategory } from '../models/category.model';
import { Me } from '../models/me.model';
import { Payee } from '../models/payee.model';
import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type {
  TransactionRow,
  UpdateTransactionCategory,
} from '@hibiscus-frontend/shared/contracts/transactions';

/**
 * Thin wrapper around HttpClient for every `/api/*` endpoint documented in
 * docs/architecture.md. Keeps request/response shapes and URL building in one place so
 * components never assemble query params or endpoint paths themselves.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  getMe(): Observable<Me> {
    return this.http.get<Me>('/api/me');
  }

  getAccounts(): Observable<AccountRow[]> {
    return this.http.get<AccountRow[]>('/api/accounts');
  }

  getTransactions(): Observable<TransactionRow[]> {
    return this.http.get<TransactionRow[]>('/api/transactions');
  }

  /** The backend answers `204 No Content`; callers apply the change to their own copy of the row. */
  updateTransactionCategory(id: number, body: UpdateTransactionCategory): Observable<void> {
    return this.http.patch<void>(`/api/transactions/${id}`, body);
  }

  getCategories(): Observable<Category[]> {
    return this.http.get<Category[]>('/api/categories');
  }

  createCategory(body: CreateCategory): Observable<Category> {
    return this.http.post<Category>('/api/categories', body);
  }

  updateCategory(id: number, body: UpdateCategory): Observable<Category> {
    return this.http.patch<Category>(`/api/categories/${id}`, body);
  }

  deleteCategory(id: number): Observable<void> {
    return this.http.delete<void>(`/api/categories/${id}`);
  }

  getPayees(q?: string): Observable<Payee[]> {
    let params = new HttpParams();
    if (q) {
      params = params.set('q', q);
    }
    return this.http.get<Payee[]>('/api/payees', { params });
  }
}
