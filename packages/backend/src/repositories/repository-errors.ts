/**
 * Storage-independent errors of the repository interfaces (`AccountRepository`,
 * `CategoryRepository`, …). Every implementation throws these instead of driver errors, so the
 * routes catch only these and hold no MySQL knowledge:
 *
 * - the MySQL implementations translate the driver's codes: `ER_DUP_ENTRY` → `DuplicateKeyError`,
 *   `ER_NO_REFERENCED_ROW_2` → `MissingReferenceError` (the violated constraint's name picks the
 *   `reference`), `ER_ROW_IS_REFERENCED_2` → `StillReferencedError`;
 * - the demo implementations throw them directly where MariaDB would have failed.
 *
 * The original driver error, when there is one, is kept as `cause`.
 */

/** A unique key is taken already (a tax section code, another user's database). */
export class DuplicateKeyError extends Error {
  constructor(what: string, options?: ErrorOptions) {
    super(`${what} already exists`, options);
    this.name = 'DuplicateKeyError';
  }
}

/**
 * What a write referred to that does not exist:
 * - `category` — a transaction's `umsatztyp_id` (`fk_umsatz_umsatztyp`);
 * - `parent` — a category's `parent_id` (`fk_umsatztyp_umsatztyp`);
 * - `account` — a category's `konto_id` (`fk_umsatztyp_konto`);
 * - `tax-section` — a category's tax tag code (`fk_hf_tax_tag_section`);
 * - `konto` — a bank connection account mapping's `kontoId` (`fk_hf_bca_konto`).
 */
export type MissingReference = 'category' | 'parent' | 'account' | 'tax-section' | 'konto';

/** A write referred to a row that does not exist (a foreign key violation). */
export class MissingReferenceError extends Error {
  constructor(
    readonly reference: MissingReference,
    options?: ErrorOptions,
  ) {
    super(`The referenced ${reference} does not exist`, options);
    this.name = 'MissingReferenceError';
  }
}

/** A delete was refused because other rows still refer to the row (a tax section in use). */
export class StillReferencedError extends Error {
  constructor(what: string, options?: ErrorOptions) {
    super(`${what} is still referenced`, options);
    this.name = 'StillReferencedError';
  }
}
