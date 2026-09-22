import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Account } from '../models/account.model';
import { CreateCategory, Category, UpdateCategory } from '../models/category.model';
import { Me } from '../models/me.model';
import { Payee } from '../models/payee.model';
import {
  Transaction,
  TransactionsQuery,
  TransactionsResponse,
  UpdateTransactionCategory,
} from '../models/transaction.model';

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

  getAccounts(): Observable<Account[]> {
    return this.http.get<Account[]>('/api/accounts');
  }

  getTransactions(query: TransactionsQuery): Observable<TransactionsResponse> {
    let params = new HttpParams();
    if (query.accountId !== undefined) {
      params = params.set('accountId', query.accountId);
    }
    if (query.from) {
      params = params.set('from', query.from);
    }
    if (query.to) {
      params = params.set('to', query.to);
    }
    if (query.categoryId !== undefined) {
      params = params.set('categoryId', query.categoryId);
    }
    if (query.q) {
      params = params.set('q', query.q);
    }
    if (query.page !== undefined) {
      params = params.set('page', query.page);
    }
    if (query.pageSize !== undefined) {
      params = params.set('pageSize', query.pageSize);
    }
    return this.http.get<TransactionsResponse>('/api/transactions', { params });
  }

  updateTransactionCategory(id: number, body: UpdateTransactionCategory): Observable<Transaction> {
    return this.http.patch<Transaction>(`/api/transactions/${id}`, body);
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
