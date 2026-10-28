/**
 * Tax tags of categories, stored in the app-owned `hf_category_tax_tag` table (one row per tagged
 * category, foreign keys to `umsatztyp.id` and `hf_tax_section.code`), and the user-maintained tax
 * sections they point to (`hf_tax_section`). Tags never touch Hibiscus's own columns, so they
 * cannot change category matching.
 *
 * Declared here once and imported by both packages; never re-declare it on either side.
 */

/** The code of a user-maintained tax section, e.g. `St-WK`. Never `'St-0'`. */
export type TaxSectionCode = string;

/**
 * What a category is tagged with: a section code, or `'St-0'`: not tax-relevant, stops inheritance
 * from a tagged parent. `'St-0'` is built in and never served, edited or deleted as a section.
 */
export type TaxTagCode = TaxSectionCode | 'St-0';

/** One row of `GET /api/tax-tags`. */
export interface TaxTag {
  readonly category_id: number;
  readonly code: TaxTagCode;
}

/**
 * One tax section with its guidance, as `GET /api/tax-sections` serves it (ordered by code) and
 * `POST /api/tax-sections` takes it (`201` with the section as stored). The texts are the user's
 * own, in one language; `null` = not filled in.
 */
export interface TaxSection {
  readonly code: TaxSectionCode;
  readonly name: string;
  /** The tax form the section belongs to, e.g. "Anlage N". */
  readonly form: string | null;
  /** Guidance: what belongs in the section. */
  readonly belongs: string | null;
  /** Guidance: what does not. */
  readonly excludes: string | null;
  /** Guidance: the receipts to keep. */
  readonly receipts: string | null;
  /** Guidance: anything else worth knowing. */
  readonly note: string | null;
}

/**
 * Body of `PUT /api/tax-sections/:code`. `expected`: the section the edit started from; `next` may
 * change the code too, which carries the tags along. `204` on success.
 */
export interface TaxSectionUpdateRequest {
  readonly expected: TaxSection;
  readonly next: TaxSection;
}

/**
 * `409` body of the tax-section routes: the section changed meanwhile or is gone (`conflict`), is
 * still a category's tag and cannot be deleted (`in-use`), or the code is taken (`duplicate`).
 */
export interface TaxSectionError {
  readonly error: 'conflict' | 'in-use' | 'duplicate';
}

/** A category's tag change, saved with the category. `expected`: the tag the edit started from. */
export interface TaxTagUpdate {
  readonly expected: TaxTagCode | null;
  readonly next: TaxTagCode | null;
}
