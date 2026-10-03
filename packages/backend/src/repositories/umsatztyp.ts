import type { RowDataPacket } from 'mysql2/promise';
import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import { getPool } from '../db/pool';

type CategoryRowPacket = CategoryRow & RowDataPacket;

/** The selected `umsatztyp` columns, in response order (the `SELECT` list). */
export const CATEGORY_COLUMNS: (keyof CategoryRow)[] = [
  'id',
  'name',
  'nummer',
  'pattern',
  'isregex',
  'umsatztyp',
  'parent_id',
  'color',
  'customcolor',
  'kommentar',
  'konto_id',
  'konto_kategorie',
  'flags',
];

/**
 * Every row of `umsatztyp` exactly as stored. Rows are served unmodified; building the
 * parent/child tree is a frontend concern.
 */
export async function listCategories(): Promise<CategoryRow[]> {
  const pool = getPool();
  const [rows] = await pool.query<CategoryRowPacket[]>(
    `SELECT ${CATEGORY_COLUMNS.join(', ')} FROM umsatztyp ORDER BY name, id`,
  );
  return rows;
}
