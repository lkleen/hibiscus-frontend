import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type {
  CategoryCreateRequest,
  CategoryEditableFields,
  CategoryRow,
  CategoryUpdateRequest,
} from '@hibiscus-frontend/shared/contracts/categories';
import { getPool } from '../db/pool';
import { createsCycle } from '../categories/category-tree';
import { MissingReferenceError } from './repository-errors';
import type { MissingReference } from './repository-errors';
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

/** The writable columns: every selected column but `id` (derived, never restated). */
export const CATEGORY_EDITABLE_COLUMNS: (keyof CategoryEditableFields)[] = CATEGORY_COLUMNS.filter(
  (column: keyof CategoryRow): column is keyof CategoryEditableFields => column !== 'id',
);

export type CategoryUpdateResult = 'updated' | 'not-found' | 'conflict' | 'cycle';

/**
 * Hibiscus's `umsatztyp` table with the app's tax tags. An unknown `parent_id`, `konto_id` or tax
 * section throws `MissingReferenceError` (`parent`, `account`, `tax-section`).
 */
export interface CategoryRepository {
  /** Every row as stored, ordered by `name`, then `id`. */
  list(): Promise<CategoryRow[]>;
  /** The row and its tax tag in one transaction; returns it as stored. */
  create(fields: CategoryCreateRequest): Promise<CategoryRow>;
  /** Guarded by `expected` and the tax tag's `expected`; rejects cycles. */
  update(id: number, request: CategoryUpdateRequest): Promise<CategoryUpdateResult>;
}

interface CategoryParentPacket extends RowDataPacket {
  id: number;
  parent_id: number | null;
}

const FK_VIOLATION_CODE = 'ER_NO_REFERENCED_ROW_2';

/**
 * Turns a foreign key violation into `MissingReferenceError`. The server message names the
 * violated constraint (`fk_umsatztyp_konto`, `fk_umsatztyp_umsatztyp` or `fk_hf_tax_tag_section`).
 */
function translateError(error: unknown): unknown {
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code !== FK_VIOLATION_CODE) return error;
  const constraint = String(message);
  const reference: MissingReference = constraint.includes('fk_hf_tax_tag_section')
    ? 'tax-section'
    : constraint.includes('fk_umsatztyp_konto')
      ? 'account'
      : 'parent';
  return new MissingReferenceError(reference, { cause: error });
}

/** `CategoryRepository` on the user's Hibiscus MariaDB. */
export class MysqlCategoryRepository implements CategoryRepository {
  /**
   * Every row of `umsatztyp` exactly as stored. Rows are served unmodified; building the
   * parent/child tree is a frontend concern.
   */
  async list(): Promise<CategoryRow[]> {
    const pool = getPool();
    const [rows] = await pool.query<CategoryRowPacket[]>(
      `SELECT ${CATEGORY_COLUMNS.join(', ')} FROM umsatztyp ORDER BY name, id`,
    );
    return rows;
  }

  /**
   * Inserts a row and, when `taxTag` is set, its tax tag, in one DB transaction; returns the row as
   * stored (the DB may normalise values). An unknown `parent_id` / `konto_id` / tax
   * section throws `MissingReferenceError` after the rollback.
   */
  async create(fields: CategoryCreateRequest): Promise<CategoryRow> {
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
      throw translateError(error);
    } finally {
      connection.release();
    }
  }

  /**
   * Updates one row if it still holds `request.expected` and its tax tag `request.taxTag.expected`,
   * in one DB transaction (a tag mismatch is a `conflict` like a row mismatch). The tree is read
   * with `FOR UPDATE` so a concurrent re-parenting cannot slip a cycle in between check and write.
   * An unknown `parent_id` / `konto_id` / tax section
   * throws `MissingReferenceError` after the rollback.
   */
  async update(id: number, request: CategoryUpdateRequest): Promise<CategoryUpdateResult> {
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
      throw translateError(error);
    } finally {
      connection.release();
    }
  }
}
