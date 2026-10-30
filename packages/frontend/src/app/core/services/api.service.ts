import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { Me } from '../models/me.model';
import type {
  DatePresetList,
  TableDensities,
} from '@hibiscus-frontend/shared/contracts/user-settings';
import type {
  TaxSection,
  TaxSectionCode,
  TaxSectionUpdateRequest,
  TaxTag,
} from '@hibiscus-frontend/shared/contracts/tax-tags';
import type {
  BankConnection,
  BankConnectionAccountsRequest,
  BankConnectionCreateRequest,
  BankConnectionUpdateRequest,
  DiscoverDone,
  DiscoverResponse,
  SyncConnectionStatus,
  SyncStartResponse,
  TanAnswerRequest,
} from '@hibiscus-frontend/shared/contracts/sync';
import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type {
  CategoryCreateRequest,
  CategoryRow,
  CategoryUpdateRequest,
} from '@hibiscus-frontend/shared/contracts/categories';
import type {
  TransactionAssignRequest,
  TransactionRow,
  TransactionUpdateRequest,
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

  /** Saves an edit to one transaction; the backend answers `204 No Content`, `409` on a stale `expected`. */
  updateTransaction(id: number, request: TransactionUpdateRequest): Observable<void> {
    return this.http.patch<void>(`/api/transactions/${id}`, request);
  }

  /** Assigns one category to many transactions; `204` on success, `409` when any row's `expected` is stale. */
  assignCategory(request: TransactionAssignRequest): Observable<void> {
    return this.http.post<void>('/api/transactions/assign-category', request);
  }

  getCategories(): Observable<CategoryRow[]> {
    return this.http.get<CategoryRow[]>('/api/categories');
  }

  /** Answers `201 Created` with the new row as stored. */
  createCategory(request: CategoryCreateRequest): Observable<CategoryRow> {
    return this.http.post<CategoryRow>('/api/categories', request);
  }

  /** Saves an edit to one category; `204` on success, `409` when `expected` is stale, `400` `{ error: 'cycle' }` for a parent cycle. */
  updateCategory(id: number, request: CategoryUpdateRequest): Observable<void> {
    return this.http.put<void>(`/api/categories/${id}`, request);
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

  getTableDensities(): Observable<TableDensities> {
    return this.http.get<TableDensities>('/api/settings/table-densities');
  }

  /** The body is the whole map; the backend answers `204 No Content`. */
  saveTableDensities(densities: TableDensities): Observable<void> {
    return this.http.put<void>('/api/settings/table-densities', densities);
  }

  getTaxTags(): Observable<TaxTag[]> {
    return this.http.get<TaxTag[]>('/api/tax-tags');
  }

  /** The user's tax sections, ordered by code. */
  getTaxSections(): Observable<TaxSection[]> {
    return this.http.get<TaxSection[]>('/api/tax-sections');
  }

  /** Answers `201 Created` with the section as stored; `409` `{ error: 'duplicate' }` for a taken code. */
  createTaxSection(section: TaxSection): Observable<TaxSection> {
    return this.http.post<TaxSection>('/api/tax-sections', section);
  }

  /** `204` on success; `409` with a TaxSectionError when `expected` is stale or the new code is taken. */
  updateTaxSection(code: TaxSectionCode, request: TaxSectionUpdateRequest): Observable<void> {
    return this.http.put<void>(`/api/tax-sections/${encodeURIComponent(code)}`, request);
  }

  /** `204` on success; `409` `{ error: 'in-use' }` while a category is tagged with it. */
  deleteTaxSection(code: TaxSectionCode): Observable<void> {
    return this.http.delete<void>(`/api/tax-sections/${encodeURIComponent(code)}`);
  }

  getBankConnections(): Observable<BankConnection[]> {
    return this.http.get<BankConnection[]>('/api/bank-connections');
  }

  /** Answers `201` with the connection as stored. */
  createBankConnection(request: BankConnectionCreateRequest): Observable<BankConnection> {
    return this.http.post<BankConnection>('/api/bank-connections', request);
  }

  /** `204` on success; `409` `conflict` when `expected` is stale, `locked` while a run is active. */
  updateBankConnection(id: number, request: BankConnectionUpdateRequest): Observable<void> {
    return this.http.put<void>(`/api/bank-connections/${id}`, request);
  }

  /** `204` on success; `409` `locked` while a run is active. */
  deleteBankConnection(id: number): Observable<void> {
    return this.http.delete<void>(`/api/bank-connections/${id}`);
  }

  /** Logs in at the bank; answers the accounts and TAN methods, or a TAN request. `409` `locked` while busy. */
  discoverBankConnection(id: number): Observable<DiscoverResponse> {
    return this.http.post<DiscoverResponse>(`/api/bank-connections/${id}/discover`, {});
  }

  /** The result of a TAN-gated discovery once its run succeeded. */
  getBankConnectionDiscovery(id: number): Observable<DiscoverDone> {
    return this.http.get<DiscoverDone>(`/api/bank-connections/${id}/discovery`);
  }

  /** Replaces the whole account mapping; `204`. */
  saveBankConnectionAccounts(id: number, request: BankConnectionAccountsRequest): Observable<void> {
    return this.http.put<void>(`/api/bank-connections/${id}/accounts`, request);
  }

  /** Starts a run in the background: `202`; `409` `locked` while a run is active. */
  syncBankConnection(id: number): Observable<SyncStartResponse> {
    return this.http.post<SyncStartResponse>(`/api/bank-connections/${id}/sync`, {});
  }

  getSyncStatus(): Observable<SyncConnectionStatus[]> {
    return this.http.get<SyncConnectionStatus[]>('/api/sync/status');
  }

  /** `204`; `409` `no-challenge` when the run is not waiting. */
  answerTan(runId: number, request: TanAnswerRequest): Observable<void> {
    return this.http.post<void>(`/api/sync/runs/${runId}/tan`, request);
  }
}
