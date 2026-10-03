import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '../db/pool';

export interface Category {
  id: number;
  name: string;
  parentId: number | null;
  color: string | null;
}

interface CategoryRow extends RowDataPacket {
  id: number;
  name: string;
  parent_id: number | null;
  color: string | null;
}

function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    color: row.color,
  };
}

/** Flat list, ordered by name — building the parent/child tree is a frontend concern. */
export async function listCategories(): Promise<Category[]> {
  const pool = getPool();
  const [rows] = await pool.query<CategoryRow[]>(
    `SELECT id, name, parent_id, color FROM umsatztyp ORDER BY name`,
  );
  return rows.map(toCategory);
}
