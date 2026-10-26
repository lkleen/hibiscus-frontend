import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type {
  TaxTag,
  TaxTagChange,
  TaxTagCode,
  TaxTagsUpdateRequest,
} from '@hibiscus-frontend/shared/contracts/tax-tags';
import { getPool } from '../db/pool';
import { TAX_TAG_CODES } from '../tax/tax-tag-codes';

interface TaxTagRow extends RowDataPacket {
  category_id: number;
  code: TaxTagCode;
}

export type TaxTagApplyResult = { result: 'saved' } | { result: 'conflict'; conflictIds: number[] };

/** MySQL error codes that mean "someone else changed this category's tag / deleted the category". */
const DUPLICATE_ENTRY_CODE = 'ER_DUP_ENTRY';
const NO_REFERENCED_ROW_CODE = 'ER_NO_REFERENCED_ROW_2';

/**
 * Create the app-owned tax tag tables (prefix `hf_`, clear of Hibiscus's own schema) and seed the
 * section codes (`INSERT IGNORE`, never deletes).
 *
 * Tags live in their own table, not in `umsatztyp.nummer`, because writing them into a Hibiscus
 * column would change Hibiscus's category matching order. The foreign keys keep a tag attached when
 * a category id changes (`ON UPDATE CASCADE`) and remove it when the category is deleted
 * (`ON DELETE CASCADE`); a section code in use cannot be deleted (`ON DELETE RESTRICT`).
 */
export async function ensureTaxTagTables(): Promise<void> {
  const pool = getPool();
  await pool.query(
    `CREATE TABLE IF NOT EXISTS hf_tax_section (code VARCHAR(16) NOT NULL PRIMARY KEY) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hf_category_tax_tag (
      category_id INT(10) NOT NULL PRIMARY KEY,
      code VARCHAR(16) NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_hf_tax_tag_category FOREIGN KEY (category_id) REFERENCES umsatztyp (id) ON UPDATE CASCADE ON DELETE CASCADE,
      CONSTRAINT fk_hf_tax_tag_section FOREIGN KEY (code) REFERENCES hf_tax_section (code) ON UPDATE CASCADE ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await pool.query('INSERT IGNORE INTO hf_tax_section (code) VALUES ?', [
    TAX_TAG_CODES.map((code: TaxTagCode): string[] => [code]),
  ]);
}

/** Every tagged category, ordered by category id. */
export async function listTaxTags(): Promise<TaxTag[]> {
  const [rows] = await getPool().query<TaxTagRow[]>(
    'SELECT category_id, code FROM hf_category_tax_tag ORDER BY category_id',
  );
  return rows.map((row: TaxTagRow): TaxTag => ({ category_id: row.category_id, code: row.code }));
}

function isErrorWithCode(error: unknown, code: string): boolean {
  return (error as { code?: unknown }).code === code;
}

/** Runs one change guarded by its `expected` tag; returns whether it matched exactly one row. */
async function applyChange(connection: PoolConnection, change: TaxTagChange): Promise<boolean> {
  const { category_id, expected, next } = change;
  let result: ResultSetHeader;
  try {
    if (expected === null) {
      [result] = await connection.query<ResultSetHeader>(
        'INSERT INTO hf_category_tax_tag (category_id, code) VALUES (?, ?)',
        [category_id, next],
      );
    } else if (next === null) {
      [result] = await connection.query<ResultSetHeader>(
        'DELETE FROM hf_category_tax_tag WHERE category_id = ? AND code = ?',
        [category_id, expected],
      );
    } else {
      [result] = await connection.query<ResultSetHeader>(
        'UPDATE hf_category_tax_tag SET code = ? WHERE category_id = ? AND code = ?',
        [next, category_id, expected],
      );
    }
  } catch (error: unknown) {
    // Already tagged by someone else, or the category is gone: a conflict, not a failure.
    if (isErrorWithCode(error, DUPLICATE_ENTRY_CODE)) return false;
    if (isErrorWithCode(error, NO_REFERENCED_ROW_CODE)) return false;
    throw error;
  }
  if (result.affectedRows === 0) return false;
  if (result.affectedRows !== 1) {
    throw new Error(
      `Changing the tax tag of category ${category_id} affected ${result.affectedRows} rows`,
    );
  }
  return true;
}

/**
 * Applies many tag changes in one DB transaction, all or nothing. Each change is guarded by the tag
 * it expects (null = untagged); a change that no longer matches is collected as a conflict and
 * rolls everything back.
 */
export async function applyTaxTagChanges(
  request: TaxTagsUpdateRequest,
): Promise<TaxTagApplyResult> {
  const connection: PoolConnection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const conflictIds: number[] = [];
    // Ascending id order, so two overlapping requests lock rows in the same order and cannot
    // deadlock each other.
    const changes: TaxTagChange[] = [...request.changes].sort(
      (a: TaxTagChange, b: TaxTagChange): number => a.category_id - b.category_id,
    );
    for (const change of changes) {
      if (!(await applyChange(connection, change))) conflictIds.push(change.category_id);
    }
    if (conflictIds.length > 0) {
      await connection.rollback();
      return { result: 'conflict', conflictIds };
    }
    await connection.commit();
    return { result: 'saved' };
  } catch (error: unknown) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
