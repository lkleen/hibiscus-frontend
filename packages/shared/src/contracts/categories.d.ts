/**
 * One row of Hibiscus's `umsatztyp` table exactly as `GET /api/categories` serves it: the selected
 * columns under their DB names, unmodified.
 *
 * The DB layout is fixed for compatibility with the desktop client and this type mirrors it
 * one-to-one — the API neither renames nor derives anything. The UI never shows a column name,
 * every visible label comes from the translations.
 *
 * Declared here once and imported by both packages; never re-declare it on either side.
 */
export interface CategoryRow {
  id: number;
  name: string;
  /** Foreign key to category account (nullable). */
  nummer: string | null;
  /** Pattern for automatic categorization (nullable). */
  pattern: string | null;
  /** Non-zero (true) only when `pattern` is a regular expression; otherwise null or 0. */
  isregex: number | null;
  /** 0 = expense, 1 = income, 2 or null = any. */
  umsatztyp: number | null;
  /** Self-reference forming the category tree; null if root. */
  parent_id: number | null;
  /** Color stored as "r,g,b" (three integers) or "#rrggbb" (older format); only shown when `customcolor === 1`. */
  color: string | null;
  /** Non-zero (true, 1) only when a custom color is set; otherwise null or 0. */
  customcolor: number | null;
  /** Category note or comment (nullable). */
  kommentar: string | null;
  /** Foreign key to account (nullable). */
  konto_id: number | null;
  /** Account-specific category label (nullable). */
  konto_kategorie: string | null;
  /** Bitfield: bit 1 set means skip in reports. */
  flags: number | null;
}
