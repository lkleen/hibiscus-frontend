import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type {
  CategoryCreateRequest,
  CategoryEditableFields,
  CategoryRow,
  CategoryUpdateRequest,
} from '@hibiscus-frontend/shared/contracts/categories';
import { getPool } from '../db/pool';
import { applyTaxTagUpdate } from './tax-tag';

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

/** The writable columns: every selected column but `id` (derived, never restated). */
export const CATEGORY_EDITABLE_COLUMNS: (keyof CategoryEditableFields)[] = CATEGORY_COLUMNS.filter(
  (column: keyof CategoryRow): column is keyof CategoryEditableFields => column !== 'id',
);

/**
 * Inserts a row and, when `taxTag` is set, its tax tag, in one DB transaction; returns the row as
 * stored (the DB may normalise values). A foreign key violation (unknown `parent_id` / `konto_id` /
 * tax section) is thrown to the caller after the rollback.
 */
export async function createCategory(fields: CategoryCreateRequest): Promise<CategoryRow> {
  const connection: PoolConnection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.query<ResultSetHeader>(
      `INSERT INTO umsatztyp (${CATEGORY_EDITABLE_COLUMNS.join(', ')})
       VALUES (${CATEGORY_EDITABLE_COLUMNS.map(() => '?').join(', ')})`,
      CATEGORY_EDITABLE_COLUMNS.map((column: keyof CategoryEditableFields) => fields[column]),
    );
    if (fields.taxTag !== null) {
      const tagged: boolean = await applyTaxTagUpdate(connection, {
        categoryId: result.insertId,
        update: { expected: null, next: fields.taxTag },
      });
      if (!tagged) throw new Error(`New umsatztyp ${result.insertId} already has a tax tag`);
    }
    const [rows] = await connection.query<CategoryRowPacket[]>(
      `SELECT ${CATEGORY_COLUMNS.join(', ')} FROM umsatztyp WHERE id = ?`,
      [result.insertId],
    );
    const created: CategoryRow | undefined = rows[0];
    if (!created) throw new Error(`Created umsatztyp ${result.insertId} could not be read back`);
    await connection.commit();
    return created;
  } catch (error: unknown) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export type CategoryUpdateResult = 'updated' | 'not-found' | 'conflict' | 'cycle';

interface CategoryParentPacket extends RowDataPacket {
  id: number;
  parent_id: number | null;
}

/** True when `parentId` is `id` itself or has `id` among its ancestors. */
function createsCycle(
  id: number,
  parentId: number | null,
  parents: Map<number, number | null>,
): boolean {
  const visited: Set<number> = new Set<number>();
  let current: number | null = parentId;
  while (current !== null) {
    if (current === id) return true;
    if (visited.has(current)) throw new Error(`umsatztyp ${current} is part of a parent loop`);
    visited.add(current);
    current = parents.get(current) ?? null;
  }
  return false;
}

/**
 * Updates one row if it still holds `request.expected` and its tax tag `request.taxTag.expected`,
 * in one DB transaction (a tag mismatch is a `conflict` like a row mismatch). The tree is read
 * with `FOR UPDATE` so a concurrent re-parenting cannot slip a cycle in between check and write.
 * A foreign key violation (unknown `parent_id` / `konto_id` / tax section) is thrown to the caller after the
 * rollback.
 */
export async function updateCategory(
  id: number,
  request: CategoryUpdateRequest,
): Promise<CategoryUpdateResult> {
  const { expected, next } = request;
  const connection: PoolConnection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [tree] = await connection.query<CategoryParentPacket[]>(
      'SELECT id, parent_id FROM umsatztyp FOR UPDATE',
    );
    const parents: Map<number, number | null> = new Map<number, number | null>(
      tree.map((row: CategoryParentPacket): [number, number | null] => [row.id, row.parent_id]),
    );
    if (!parents.has(id)) {
      await connection.rollback();
      return 'not-found';
    }
    if (createsCycle(id, next.parent_id, parents)) {
      await connection.rollback();
      return 'cycle';
    }
    // FOUND_ROWS: `affectedRows` counts matched rows (see `updateTransaction`), so an unchanged
    // edit still yields 1.
    const [result] = await connection.query<ResultSetHeader>(
      `UPDATE umsatztyp SET ${CATEGORY_EDITABLE_COLUMNS.map((c: string) => `${c} = ?`).join(', ')}
       WHERE id = ? AND ${CATEGORY_EDITABLE_COLUMNS.map((c: string) => `${c} <=> ?`).join(' AND ')}`,
      [
        ...CATEGORY_EDITABLE_COLUMNS.map((c: keyof CategoryEditableFields) => next[c]),
        id,
        ...CATEGORY_EDITABLE_COLUMNS.map((c: keyof CategoryEditableFields) => expected[c]),
      ],
    );
    if (result.affectedRows === 0) {
      await connection.rollback();
      return 'conflict';
    }
    if (result.affectedRows !== 1) {
      throw new Error(`Updating umsatztyp ${id} affected ${result.affectedRows} rows`);
    }
    const tagMatched: boolean = await applyTaxTagUpdate(connection, {
      categoryId: id,
      update: request.taxTag,
    });
    if (!tagMatched) {
      await connection.rollback();
      return 'conflict';
    }
    await connection.commit();
    return 'updated';
  } catch (error: unknown) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
