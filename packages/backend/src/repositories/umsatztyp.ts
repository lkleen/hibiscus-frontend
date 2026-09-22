import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getPool } from '../db/pool';

export interface Category {
  id: number;
  name: string;
  parentId: number | null;
  color: string | null;
}

export interface CreateCategoryInput {
  name: string;
  parentId: number | null;
  color: string | null;
}

export interface UpdateCategoryInput {
  name?: string;
  parentId?: number | null;
  color?: string | null;
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

export async function createCategory(input: CreateCategoryInput): Promise<Category> {
  const pool = getPool();
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO umsatztyp (name, parent_id, color) VALUES (?, ?, ?)`,
    [input.name, input.parentId, input.color],
  );
  return { id: result.insertId, name: input.name, parentId: input.parentId, color: input.color };
}

export async function updateCategory(id: number, input: UpdateCategoryInput): Promise<void> {
  const pool = getPool();
  const assignments: string[] = [];
  const params: (string | number | null)[] = [];

  if (input.name !== undefined) {
    assignments.push('name = ?');
    params.push(input.name);
  }
  if (input.parentId !== undefined) {
    assignments.push('parent_id = ?');
    params.push(input.parentId);
  }
  if (input.color !== undefined) {
    assignments.push('color = ?');
    params.push(input.color);
  }

  if (assignments.length === 0) {
    return;
  }

  params.push(id);
  await pool.query(`UPDATE umsatztyp SET ${assignments.join(', ')} WHERE id = ?`, params);
}

export async function deleteCategory(id: number): Promise<void> {
  const pool = getPool();
  await pool.query(`DELETE FROM umsatztyp WHERE id = ?`, [id]);
}
