import type { Pool, PoolConnection } from 'mysql2/promise';
import type { TaxTagUpdate } from '@hibiscus-frontend/shared/contracts/tax-tags';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/pool', () => ({
  getPool: vi.fn(),
}));

import { getPool } from '../db/pool';
import { DEFAULT_TAX_SECTIONS, TAX_NOT_RELEVANT_SECTION } from '../tax/tax-section-defaults';
import { applyTaxTagUpdate, ensureTaxTagTables, listTaxTags } from './tax-tag';

function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('ensureTaxTagTables', () => {
  function poolWithColumns(columns: string[]): { query: ReturnType<typeof vi.fn> } {
    const pool: { query: ReturnType<typeof vi.fn> } = { query: vi.fn() };
    pool.query.mockResolvedValueOnce([columns.map((c: string) => ({ column_name: c }))]);
    pool.query.mockResolvedValue([{}]);
    vi.mocked(getPool).mockReturnValue(pool as unknown as Pool);
    return pool;
  }

  function statements(pool: { query: ReturnType<typeof vi.fn> }): string[] {
    return (pool.query.mock.calls as [string][]).slice(1).map(([sql]: [string]) => normalize(sql));
  }

  it('creates the section table and seeds the defaults plus St-0 when it does not exist', async () => {
    const pool = poolWithColumns([]);

    await ensureTaxTagTables();

    const sql: string[] = statements(pool);
    expect(sql[0]).toContain('CREATE TABLE hf_tax_section');
    expect(sql[0]).toContain('name VARCHAR(200) NOT NULL');
    expect(sql[1]).toContain('INSERT INTO hf_tax_section');
    const rows = (pool.query.mock.calls[2] as [string, unknown[][][]])[1][0];
    expect(rows.map((r: unknown[]) => r[0])).toEqual([
      ...DEFAULT_TAX_SECTIONS.map((s) => s.code),
      TAX_NOT_RELEVANT_SECTION.code,
    ]);
    expect(sql[2]).toContain('CREATE TABLE IF NOT EXISTS hf_category_tax_tag');
    expect(sql[2]).toContain(
      'REFERENCES hf_tax_section (code) ON UPDATE CASCADE ON DELETE RESTRICT',
    );
  });

  it('migrates the old one-column table: adds the columns, fills the defaults once', async () => {
    const pool = poolWithColumns(['code']);

    await ensureTaxTagTables();

    const sql: string[] = statements(pool);
    expect(sql[0]).toContain('ALTER TABLE hf_tax_section ADD COLUMN name');
    expect(sql[1]).toContain('INSERT INTO hf_tax_section');
    expect(sql[1]).toContain('ON DUPLICATE KEY UPDATE name = VALUES(name)');
    expect(sql[2]).toContain('MODIFY name VARCHAR(200) NOT NULL');
  });

  it('never re-seeds a migrated table, it only ensures St-0', async () => {
    const pool = poolWithColumns([
      'code',
      'name',
      'form',
      'belongs',
      'excludes',
      'receipts',
      'note',
    ]);

    await ensureTaxTagTables();

    const sql: string[] = statements(pool);
    expect(sql[0]).toContain('INSERT IGNORE INTO hf_tax_section (code, name) VALUES (?, ?)');
    expect(pool.query.mock.calls[1]?.[1]).toEqual(['St-0', TAX_NOT_RELEVANT_SECTION.name]);
    expect(sql.some((s: string) => s.includes('ON DUPLICATE KEY'))).toBe(false);
  });
});

describe('listTaxTags', () => {
  it('returns the rows ordered by category id', async () => {
    const pool: { query: ReturnType<typeof vi.fn> } = {
      query: vi.fn().mockResolvedValue([[{ category_id: 1, code: 'St-WK' }]]),
    };
    vi.mocked(getPool).mockReturnValue(pool as unknown as Pool);

    expect(await listTaxTags()).toEqual([{ category_id: 1, code: 'St-WK' }]);
    expect((pool.query.mock.calls[0] as [string])[0]).toContain('ORDER BY category_id');
  });
});

describe('applyTaxTagUpdate', () => {
  let connection: { query: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    connection = { query: vi.fn() };
  });

  function run(update: TaxTagUpdate, stored: string | null, write?: unknown): Promise<boolean> {
    connection.query.mockResolvedValueOnce([
      stored === null ? [] : [{ category_id: 4, code: stored }],
    ]);
    if (write instanceof Error) connection.query.mockRejectedValueOnce(write);
    else if (write !== undefined) connection.query.mockResolvedValueOnce(write);
    return applyTaxTagUpdate(connection as unknown as PoolConnection, {
      categoryId: 4,
      update,
    });
  }

  it('locks the row with SELECT ... FOR UPDATE', async () => {
    await run({ expected: null, next: null }, null);
    expect(connection.query.mock.calls[0]?.[0]).toContain('FOR UPDATE');
  });

  it('inserts when untagged', async () => {
    expect(await run({ expected: null, next: 'St-SA' }, null, [{ affectedRows: 1 }])).toBe(true);
    expect(connection.query.mock.calls[1]).toEqual([
      'INSERT INTO hf_category_tax_tag (category_id, code) VALUES (?, ?)',
      [4, 'St-SA'],
    ]);
  });

  it('deletes when next is null', async () => {
    expect(await run({ expected: 'St-V', next: null }, 'St-V', [{ affectedRows: 1 }])).toBe(true);
    expect(connection.query.mock.calls[1]).toEqual([
      'DELETE FROM hf_category_tax_tag WHERE category_id = ? AND code = ?',
      [4, 'St-V'],
    ]);
  });

  it('updates when the tag changes', async () => {
    expect(await run({ expected: 'St-WK', next: 'St-0' }, 'St-WK', [{ affectedRows: 1 }])).toBe(
      true,
    );
    expect(connection.query.mock.calls[1]).toEqual([
      'UPDATE hf_category_tax_tag SET code = ? WHERE category_id = ? AND code = ?',
      ['St-0', 4, 'St-WK'],
    ]);
  });

  it('writes nothing when expected equals next and matches', async () => {
    expect(await run({ expected: 'St-WK', next: 'St-WK' }, 'St-WK')).toBe(true);
    expect(connection.query).toHaveBeenCalledTimes(1);
  });

  it('returns false without writing when expected equals next but differs from stored', async () => {
    expect(await run({ expected: 'St-WK', next: 'St-WK' }, 'St-V')).toBe(false);
    expect(connection.query).toHaveBeenCalledTimes(1);
  });

  it('returns false when the stored tag differs from expected', async () => {
    expect(await run({ expected: null, next: 'St-SA' }, 'St-V')).toBe(false);
    expect(connection.query).toHaveBeenCalledTimes(1);
  });

  it('treats a duplicate entry race as a mismatch', async () => {
    const dup: Error = Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
    expect(await run({ expected: null, next: 'St-SA' }, null, dup)).toBe(false);
  });

  it('rethrows other errors, such as an unknown section', async () => {
    const error: Error = Object.assign(new Error('fk'), { code: 'ER_NO_REFERENCED_ROW_2' });
    await expect(run({ expected: null, next: 'St-X' }, null, error)).rejects.toBe(error);
  });

  it('throws on an unexpected affected row count', async () => {
    await expect(
      run({ expected: null, next: 'St-SA' }, null, [{ affectedRows: 2 }]),
    ).rejects.toThrow('affected 2 rows');
  });
});
