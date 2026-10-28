import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type {
  TaxSection,
  TaxTag,
  TaxTagCode,
  TaxTagUpdate,
} from '@hibiscus-frontend/shared/contracts/tax-tags';
import { getPool } from '../db/pool';
import { DEFAULT_TAX_SECTIONS, TAX_NOT_RELEVANT_SECTION } from '../tax/tax-section-defaults';

interface TaxTagRow extends RowDataPacket {
  category_id: number;
  code: TaxTagCode;
}

interface ColumnNameRow extends RowDataPacket {
  column_name: string;
}

/** Parameters of `applyTaxTagUpdate`. */
export interface TaxTagUpdateParams {
  readonly categoryId: number;
  readonly update: TaxTagUpdate;
}

/** MySQL error code: the category got tagged by someone else in the meantime. */
const DUPLICATE_ENTRY_CODE = 'ER_DUP_ENTRY';

/** The `hf_tax_section` columns in `TaxSection` order (the `INSERT` list). */
const SECTION_COLUMNS: (keyof TaxSection)[] = [
  'code',
  'name',
  'form',
  'belongs',
  'excludes',
  'receipts',
  'note',
];

/** Inserts the sections, overwriting the texts of codes that already exist. */
async function upsertSections(sections: readonly TaxSection[]): Promise<void> {
  await getPool().query(
    `INSERT INTO hf_tax_section (${SECTION_COLUMNS.join(', ')}) VALUES ?
     ON DUPLICATE KEY UPDATE ${SECTION_COLUMNS.filter((c: string) => c !== 'code')
       .map((c: string) => `${c} = VALUES(${c})`)
       .join(', ')}`,
    [
      sections.map((section: TaxSection) =>
        SECTION_COLUMNS.map((c: keyof TaxSection) => section[c]),
      ),
    ],
  );
}

/**
 * Create the app-owned tax tag tables (prefix `hf_`, clear of Hibiscus's own schema).
 *
 * `hf_tax_section` is user-maintained, so it is seeded exactly once: when the table does not exist
 * it is created with the default sections, and when it still has its old one-column form the text
 * columns are added and the defaults filled in. Later startups never touch its rows, apart from
 * making sure the built-in `St-0` row (the foreign key target for "not tax-relevant") exists; a
 * section the user deleted never comes back.
 *
 * Tags live in their own table, not in `umsatztyp.nummer`, because writing them into a Hibiscus
 * column would change Hibiscus's category matching order. The foreign keys keep a tag attached when
 * a category id changes (`ON UPDATE CASCADE`) and remove it when the category is deleted
 * (`ON DELETE CASCADE`); a section code in use cannot be deleted (`ON DELETE RESTRICT`).
 */
export async function ensureTaxTagTables(): Promise<void> {
  const pool = getPool();
  const [columns] = await pool.query<ColumnNameRow[]>(
    `SELECT column_name AS column_name FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'hf_tax_section'`,
  );
  const names: Set<string> = new Set<string>(columns.map((c: ColumnNameRow) => c.column_name));
  if (names.size === 0) {
    await pool.query(`
      CREATE TABLE hf_tax_section (
        code VARCHAR(16) NOT NULL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        form VARCHAR(200) NULL,
        belongs TEXT NULL,
        excludes TEXT NULL,
        receipts TEXT NULL,
        note TEXT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await upsertSections([...DEFAULT_TAX_SECTIONS, TAX_NOT_RELEVANT_SECTION]);
  } else if (!names.has('name')) {
    await pool.query(`
      ALTER TABLE hf_tax_section
        ADD COLUMN name VARCHAR(200) NOT NULL DEFAULT '',
        ADD COLUMN form VARCHAR(200) NULL,
        ADD COLUMN belongs TEXT NULL,
        ADD COLUMN excludes TEXT NULL,
        ADD COLUMN receipts TEXT NULL,
        ADD COLUMN note TEXT NULL
    `);
    await upsertSections([...DEFAULT_TAX_SECTIONS, TAX_NOT_RELEVANT_SECTION]);
    await pool.query('ALTER TABLE hf_tax_section MODIFY name VARCHAR(200) NOT NULL');
  } else {
    await pool.query('INSERT IGNORE INTO hf_tax_section (code, name) VALUES (?, ?)', [
      TAX_NOT_RELEVANT_SECTION.code,
      TAX_NOT_RELEVANT_SECTION.name,
    ]);
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hf_category_tax_tag (
      category_id INT(10) NOT NULL PRIMARY KEY,
      code VARCHAR(16) NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_hf_tax_tag_category FOREIGN KEY (category_id) REFERENCES umsatztyp (id) ON UPDATE CASCADE ON DELETE CASCADE,
      CONSTRAINT fk_hf_tax_tag_section FOREIGN KEY (code) REFERENCES hf_tax_section (code) ON UPDATE CASCADE ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

/** Every tagged category, ordered by category id. */
export async function listTaxTags(): Promise<TaxTag[]> {
  const [rows] = await getPool().query<TaxTagRow[]>(
    'SELECT category_id, code FROM hf_category_tax_tag ORDER BY category_id',
  );
  return rows.map((row: TaxTagRow): TaxTag => ({ category_id: row.category_id, code: row.code }));
}

/** Runs the INSERT / UPDATE / DELETE that turns `expected` into `next`; they differ. */
async function writeChange(connection: PoolConnection, params: TaxTagUpdateParams): Promise<void> {
  const { categoryId, update } = params;
  let result: ResultSetHeader;
  if (update.expected === null) {
    [result] = await connection.query<ResultSetHeader>(
      'INSERT INTO hf_category_tax_tag (category_id, code) VALUES (?, ?)',
      [categoryId, update.next],
    );
  } else if (update.next === null) {
    [result] = await connection.query<ResultSetHeader>(
      'DELETE FROM hf_category_tax_tag WHERE category_id = ? AND code = ?',
      [categoryId, update.expected],
    );
  } else {
    [result] = await connection.query<ResultSetHeader>(
      'UPDATE hf_category_tax_tag SET code = ? WHERE category_id = ? AND code = ?',
      [update.next, categoryId, update.expected],
    );
  }
  if (result.affectedRows !== 1) {
    throw new Error(
      `Changing the tax tag of category ${categoryId} affected ${result.affectedRows} rows`,
    );
  }
}

/**
 * Changes one category's tag inside the caller's transaction, guarded by `update.expected`
 * (null = untagged). The stored tag is read with `FOR UPDATE` and compared, so `expected === next`
 * is verified too; writes happen only when the two differ. Returns whether the stored tag matched
 * `expected`. An unknown section code throws the foreign key error (`fk_hf_tax_tag_section`) for the
 * caller to answer as a 400.
 */
export async function applyTaxTagUpdate(
  connection: PoolConnection,
  params: TaxTagUpdateParams,
): Promise<boolean> {
  const { categoryId, update } = params;
  const [rows] = await connection.query<TaxTagRow[]>(
    'SELECT category_id, code FROM hf_category_tax_tag WHERE category_id = ? FOR UPDATE',
    [categoryId],
  );
  const stored: TaxTagCode | null = rows[0]?.code ?? null;
  if (stored !== update.expected) return false;
  if (update.expected === update.next) return true;
  try {
    await writeChange(connection, params);
  } catch (error: unknown) {
    // Another transaction tagged the category between our read and write: a conflict.
    if ((error as { code?: unknown }).code === DUPLICATE_ENTRY_CODE) return false;
    throw error;
  }
  return true;
}
