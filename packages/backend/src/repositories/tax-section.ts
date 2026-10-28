import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { TaxSection, TaxSectionCode } from '@hibiscus-frontend/shared/contracts/tax-tags';
import { getPool } from '../db/pool';
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

/** Every user-maintained section ordered by code; the built-in `St-0` row is not one. */
export async function listTaxSections(): Promise<TaxSection[]> {
  const [rows] = await getPool().query<TaxSectionPacket[]>(
    `SELECT ${TAX_SECTION_COLUMNS.join(', ')} FROM hf_tax_section WHERE code <> ? ORDER BY code`,
    [TAX_NOT_RELEVANT_CODE],
  );
  return rows;
}

/**
 * Inserts a section and returns it as stored. A taken code throws the `ER_DUP_ENTRY` error for the
 * caller to answer as a 409.
 */
export async function createTaxSection(section: TaxSection): Promise<TaxSection> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO hf_tax_section (${TAX_SECTION_COLUMNS.join(', ')})
     VALUES (${TAX_SECTION_COLUMNS.map(() => '?').join(', ')})`,
    TAX_SECTION_COLUMNS.map((c: keyof TaxSection) => section[c]),
  );
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
 * (`ON UPDATE CASCADE`); a taken code throws the `ER_DUP_ENTRY` error for the caller.
 */
export async function updateTaxSection(
  expected: TaxSection,
  next: TaxSection,
): Promise<TaxSectionUpdateResult> {
  // FOUND_ROWS: `affectedRows` counts matched rows, so an unchanged edit still yields 1.
  const [result] = await getPool().query<ResultSetHeader>(
    `UPDATE hf_tax_section SET ${TAX_SECTION_COLUMNS.map((c: string) => `${c} = ?`).join(', ')}
     WHERE ${TAX_SECTION_COLUMNS.map((c: string) => `${c} <=> ?`).join(' AND ')}`,
    [
      ...TAX_SECTION_COLUMNS.map((c: keyof TaxSection) => next[c]),
      ...TAX_SECTION_COLUMNS.map((c: keyof TaxSection) => expected[c]),
    ],
  );
  if (result.affectedRows === 0) return 'conflict';
  if (result.affectedRows !== 1) {
    throw new Error(`Updating tax section ${expected.code} affected ${result.affectedRows} rows`);
  }
  return 'updated';
}

/**
 * Deletes a section; false when there is none. A section still used as a tag throws the
 * `ER_ROW_IS_REFERENCED_2` error for the caller to answer as a 409.
 */
export async function deleteTaxSection(code: TaxSectionCode): Promise<boolean> {
  const [result] = await getPool().query<ResultSetHeader>(
    'DELETE FROM hf_tax_section WHERE code = ? AND code <> ?',
    [code, TAX_NOT_RELEVANT_CODE],
  );
  return result.affectedRows === 1;
}
