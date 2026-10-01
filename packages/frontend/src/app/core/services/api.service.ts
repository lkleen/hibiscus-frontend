import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { CreateCategory, Category, UpdateCategory } from '../models/category.model';
import { Me } from '../models/me.model';
import { Payee } from '../models/payee.model';
import type { DatePresetList } from '@hibiscus-frontend/shared/contracts/user-settings';
import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type {
  TransactionRow,
  TransactionsResponse,
  UpdateTransactionCategory,
} from '@hibiscus-frontend/shared/contracts/transactions';

/**
 * Turns the columnar `GET /api/transactions` payload back into raw rows, pairing each value with
 * its column name. Throws on a row whose length does not match `columns` — a malformed payload is
 * an error, never a partial row.
 */
export function toTransactionRows(response: TransactionsResponse): TransactionRow[] {
  const { columns, rows } = response;
  return rows.map((values: TransactionsResponse['rows'][number], index: number) => {
    if (values.length !== columns.length) {
      throw new Error(
        `Transaction row ${index} has ${values.length} values for ${columns.length} columns`,
      );
    }
    // The backend contract guarantees `columns` are exactly `TransactionRow`'s keys and each row
    // holds their values in that order; this is the one place that relies on it.
    return Object.fromEntries(
      columns.map((column: keyof TransactionRow, i: number) => [column, values[i]]),
    ) as unknown as TransactionRow;
  });
}

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
    return this.http.get<TransactionsResponse>('/api/transactions').pipe(map(toTransactionRows));
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

  /** The backend answers the stored list, or the defaults when the user has none stored. */
  getDatePresets(): Observable<DatePresetList> {
    return this.http.get<DatePresetList>('/api/settings/date-presets');
  }

  /** Replaces the whole list; the backend answers `204 No Content`. */
  saveDatePresets(presets: DatePresetList): Observable<void> {
    return this.http.put<void>('/api/settings/date-presets', presets);
  }

  /** Deletes the stored list so the defaults apply again; answers `204 No Content`. */
  resetDatePresets(): Observable<void> {
    return this.http.delete<void>('/api/settings/date-presets');
  }
}
