/**
 * One row of Hibiscus's `umsatz` table exactly as `GET /api/transactions` serves it: the selected
 * columns under their DB names, unmodified.
 *
 * The DB layout is fixed for compatibility with the desktop client and this type mirrors it
 * one-to-one — the API neither renames nor derives anything. The UI never shows a column name,
 * every visible label comes from the translations.
 *
 * Declared here once and imported by both packages; never re-declare it on either side.
 */
export interface TransactionRow {
  id: number;
  konto_id: number;
  empfaenger_konto: string | null;
  empfaenger_blz: string | null;
  empfaenger_name: string | null;
  empfaenger_name2: string | null;
  betrag: number;
  zweck: string | null;
  zweck2: string | null;
  zweck3: string | null;
  /** `YYYY-MM-DD` (the DB pool returns dates as strings). */
  datum: string;
  valuta: string;
  saldo: number | null;
  art: string | null;
  gvcode: string | null;
  endtoendid: string | null;
  /** Served for Hibiscus-style category pattern matching and not displayed. */
  kommentar: string | null;
  /** Served for Hibiscus-style category pattern matching and not displayed. */
  purposecode: string | null;
  /** Served for Hibiscus-style category pattern matching and not displayed. */
  customerref: string | null;
  /** Served for Hibiscus-style category pattern matching and not displayed. */
  mandateid: string | null;
  /** Served for Hibiscus-style category pattern matching and not displayed. */
  creditorid: string | null;
  umsatztyp_id: number | null;
}

/** A `TransactionRow` column name — the DB column name. */
export type TransactionColumn = keyof TransactionRow;

/** Any single `TransactionRow` column value. */
export type TransactionValue = TransactionRow[TransactionColumn];

/**
 * Response of `GET /api/transactions`, columnar to keep the payload small: the column names once,
 * then each row as its values in `columns` order. Names and values are exactly those of
 * `TransactionRow`; only the transport shape differs.
 */
export interface TransactionsResponse {
  columns: TransactionColumn[];
  rows: TransactionValue[][];
}
