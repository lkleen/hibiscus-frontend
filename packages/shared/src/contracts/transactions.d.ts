/**
 * One row of Hibiscus's `umsatz` table as served by `GET /api/transactions`.
 *
 * Field names mirror the Hibiscus schema (German) on purpose — the DB layout is fixed and must
 * stay compatible with the desktop client. They are an API detail: the UI never shows a field name,
 * every visible label comes from the translations.
 *
 * Declared here once and imported by both packages; never re-declare it on either side.
 */
export interface Transaction {
  id: number;
  kontoId: number;
  empfaengerKonto: string | null;
  empfaengerBlz: string | null;
  empfaengerName: string | null;
  empfaengerName2: string | null;
  betrag: number;
  zweck: string | null;
  zweck2: string | null;
  zweck3: string | null;
  /** `YYYY-MM-DD` (the DB pool returns dates as strings). */
  datum: string;
  valuta: string;
  saldo: number | null;
  umsatztypId: number | null;
}

/** Query of `GET /api/transactions`. Results are ordered `datum DESC, id DESC`. */
export interface TransactionsQuery {
  accountId?: number;
  /** `YYYY-MM-DD`, inclusive. */
  from?: string;
  /** `YYYY-MM-DD`, inclusive. */
  to?: string;
  categoryId?: number;
  /** Free-text search over purpose and counterparty name. */
  q?: string;
  /** Rows per response (a "chunk"); the server enforces an upper bound. */
  limit: number;
  offset: number;
}

export interface TransactionListResponse {
  items: Transaction[];
  /** Number of rows matching the filters, independent of `limit`/`offset`. */
  total: number;
}

/** Body of `PATCH /api/transactions/:id`; the endpoint answers `204 No Content`. */
export interface UpdateTransactionCategory {
  categoryId: number | null;
}
