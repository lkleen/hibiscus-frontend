/**
 * Tax-return tags of categories, stored in the app-owned `hf_category_tax_tag` table (one row per
 * tagged category, foreign keys to `umsatztyp.id` and `hf_tax_section.code`). Tags never touch
 * Hibiscus's own columns, so they cannot change category matching.
 *
 * Declared here once and imported by both packages; never re-declare it on either side.
 */

/** One section of the German income tax return. */
export type TaxSectionCode = 'St-WK' | 'St-VA' | 'St-SA' | 'St-AB' | 'St-HH' | 'St-KI' | 'St-V';

/** A section, or `'St-0'`: not tax-relevant, stops inheritance from a tagged parent. */
export type TaxTagCode = TaxSectionCode | 'St-0';

/** One row of `GET /api/tax-tags`. */
export interface TaxTag {
  readonly category_id: number;
  readonly code: TaxTagCode;
}

/** One change. `expected`: the tag the edit started from (null = untagged); never equal to `next`. */
export interface TaxTagChange {
  readonly category_id: number;
  readonly expected: TaxTagCode | null;
  readonly next: TaxTagCode | null;
}

/** Body of `PUT /api/tax-tags`: applied all or nothing; `204` on success. */
export interface TaxTagsUpdateRequest {
  readonly changes: readonly TaxTagChange[];
}

/** `409` body of `PUT /api/tax-tags`: categories whose tag changed (or that no longer exist). */
export interface TaxTagsConflict {
  readonly error: 'conflict';
  readonly conflictIds: readonly number[];
}
