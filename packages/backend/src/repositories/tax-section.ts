import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { TaxSection, TaxSectionCode } from '@hibiscus-frontend/shared/contracts/tax-tags';
import { getPool } from '../db/pool';
import { DuplicateKeyError, StillReferencedError } from './repository-errors';
import { TAX_NOT_RELEVANT_CODE } from '../tax/tax-section-defaults';

type TaxSectionPacket = TaxSection & RowDataPacket;

/** The `hf_tax_section` columns in `TaxSection` order. */
export const TAX_SECTION_COLUMNS: (keyof TaxSection)[] = [
  'code',
  'name',
  'form',
  'belongs',
  'excludes',
  'receipts',
  'note',
];

export type TaxSectionUpdateResult = 'updated' | 'conflict';

/** The user-maintained `hf_tax_section` table; the built-in `St-0` row is never listed or deleted. */
export interface TaxSectionRepository {
  /** Every user-maintained section, ordered by code. */
  list(): Promise<TaxSection[]>;
  /** Inserts and returns the section as stored; a taken code throws `DuplicateKeyError`. */
  create(section: TaxSection): Promise<TaxSection>;
  /**
   * Replaces `expected` with `next` if the row still holds `expected`; a changed code carries the
   * category tags along. A taken code throws `DuplicateKeyError`.
   */
  update(expected: TaxSection, next: TaxSection): Promise<TaxSectionUpdateResult>;
  /** Whether a section was deleted; one still used as a tag throws `StillReferencedError`. */
  delete(code: TaxSectionCode): Promise<boolean>;
}

const DUPLICATE_ENTRY_CODE = 'ER_DUP_ENTRY';
const ROW_IS_REFERENCED_CODE = 'ER_ROW_IS_REFERENCED_2';

/** Turns the driver's duplicate key / still-referenced errors into the domain errors. */
function translateError(error: unknown, what: string): unknown {
  const code: unknown = (error as { code?: unknown }).code;
  if (code === DUPLICATE_ENTRY_CODE) return new DuplicateKeyError(what, { cause: error });
  if (code === ROW_IS_REFERENCED_CODE) return new StillReferencedError(what, { cause: error });
  return error;
}

/** `TaxSectionRepository` on the user's Hibiscus MariaDB. */
export class MysqlTaxSectionRepository implements TaxSectionRepository {
  /** Every user-maintained section ordered by code; the built-in `St-0` row is not one. */
  async list(): Promise<TaxSection[]> {
    const [rows] = await getPool().query<TaxSectionPacket[]>(
      `SELECT ${TAX_SECTION_COLUMNS.join(', ')} FROM hf_tax_section WHERE code <> ? ORDER BY code`,
      [TAX_NOT_RELEVANT_CODE],
    );
    return rows;
  }

  /**
   * Inserts a section and returns it as stored. A taken code throws `DuplicateKeyError`.
   */
  async create(section: TaxSection): Promise<TaxSection> {
    const pool = getPool();
    try {
      await pool.query(
        `INSERT INTO hf_tax_section (${TAX_SECTION_COLUMNS.join(', ')})
         VALUES (${TAX_SECTION_COLUMNS.map(() => '?').join(', ')})`,
        TAX_SECTION_COLUMNS.map((c: keyof TaxSection) => section[c]),
      );
    } catch (error: unknown) {
      throw translateError(error, `Tax section ${section.code}`);
    }
    const [rows] = await pool.query<TaxSectionPacket[]>(
      `SELECT ${TAX_SECTION_COLUMNS.join(', ')} FROM hf_tax_section WHERE code = ?`,
      [section.code],
    );
    const created: TaxSection | undefined = rows[0];
    if (!created) throw new Error(`Created tax section ${section.code} could not be read back`);
    return created;
  }

  /**
   * Replaces `expected` with `next` if the row still holds `expected` (NULL-safe comparison of every
   * column); 0 matched rows is a `conflict`. A changed code carries the category tags along
   * (`ON UPDATE CASCADE`); a taken code throws `DuplicateKeyError`.
   */
  async update(expected: TaxSection, next: TaxSection): Promise<TaxSectionUpdateResult> {
    // FOUND_ROWS: `affectedRows` counts matched rows, so an unchanged edit still yields 1.
    let result: ResultSetHeader;
    try {
      [result] = await getPool().query<ResultSetHeader>(
        `UPDATE hf_tax_section SET ${TAX_SECTION_COLUMNS.map((c: string) => `${c} = ?`).join(', ')}
         WHERE ${TAX_SECTION_COLUMNS.map((c: string) => `${c} <=> ?`).join(' AND ')}`,
        [
          ...TAX_SECTION_COLUMNS.map((c: keyof TaxSection) => next[c]),
          ...TAX_SECTION_COLUMNS.map((c: keyof TaxSection) => expected[c]),
        ],
      );
    } catch (error: unknown) {
      throw translateError(error, `Tax section ${next.code}`);
    }
    if (result.affectedRows === 0) return 'conflict';
    if (result.affectedRows !== 1) {
      throw new Error(`Updating tax section ${expected.code} affected ${result.affectedRows} rows`);
    }
    return 'updated';
  }

  /**
   * Deletes a section; false when there is none. A section still used as a tag throws
   * `StillReferencedError`.
   */
  async delete(code: TaxSectionCode): Promise<boolean> {
    let result: ResultSetHeader;
    try {
      [result] = await getPool().query<ResultSetHeader>(
        'DELETE FROM hf_tax_section WHERE code = ? AND code <> ?',
        [code, TAX_NOT_RELEVANT_CODE],
      );
    } catch (error: unknown) {
      throw translateError(error, `Tax section ${code}`);
    }
    return result.affectedRows === 1;
  }
}
