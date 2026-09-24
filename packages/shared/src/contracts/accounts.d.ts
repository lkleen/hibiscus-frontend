/**
 * One row of Hibiscus's `konto` table exactly as `GET /api/accounts` serves it: the selected
 * columns under their DB names, unmodified. `name` is the account holder; the account's own label
 * is `bezeichnung`.
 *
 * The DB layout is fixed for compatibility with the desktop client and this type mirrors it
 * one-to-one — the API neither renames nor derives anything. The UI never shows a column name,
 * every visible label comes from the translations.
 *
 * Declared here once and imported by both packages; never re-declare it on either side.
 */
export interface AccountRow {
  id: number;
  kontonummer: string;
  unterkonto: string | null;
  blz: string;
  name: string;
  bezeichnung: string | null;
  waehrung: string;
  saldo: number | null;
  /** `YYYY-MM-DD HH:mm:ss` (the DB pool returns dates as strings). */
  saldo_datum: string | null;
  iban: string | null;
  bic: string | null;
  saldo_available: number | null;
  kategorie: string | null;
}
