import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { Me } from '../models/me.model';
import type {
  DatePresetList,
  TableDensity,
} from '@hibiscus-frontend/shared/contracts/user-settings';
import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import type {
  TransactionRow,
  TransactionsResponse,
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

  getCategories(): Observable<CategoryRow[]> {
    return this.http.get<CategoryRow[]>('/api/categories');
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

  getTableDensity(): Observable<TableDensity> {
    return this.http.get<TableDensity>('/api/settings/table-density');
  }

  /** The body is the bare JSON string; the backend answers `204 No Content`. */
  saveTableDensity(density: TableDensity): Observable<void> {
    // HttpClient sends a raw string as text/plain, so serialise and label it as JSON ourselves.
    return this.http.put<void>('/api/settings/table-density', JSON.stringify(density), {
      headers: new HttpHeaders({ 'Content-Type': 'application/json' }),
    });
  }
}
