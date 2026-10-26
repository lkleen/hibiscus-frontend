import type { Pool } from 'mysql2/promise';
import type { TaxTagsUpdateRequest } from '@hibiscus-frontend/shared/contracts/tax-tags';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/pool', () => ({
  getPool: vi.fn(),
}));

import { getPool } from '../db/pool';
import { TAX_TAG_CODES } from '../tax/tax-tag-codes';
import { applyTaxTagChanges, ensureTaxTagTables, listTaxTags } from './tax-tag';

function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('ensureTaxTagTables', () => {
  it('creates both tables with their foreign keys, then seeds every code with INSERT IGNORE', async () => {
    const pool: { query: ReturnType<typeof vi.fn> } = { query: vi.fn().mockResolvedValue([{}]) };
    vi.mocked(getPool).mockReturnValue(pool as unknown as Pool);

    await ensureTaxTagTables();

    expect(pool.query).toHaveBeenCalledTimes(3);
    const calls: [string, unknown[]?][] = pool.query.mock.calls as [string, unknown[]?][];
    expect(normalize(calls[0][0])).toContain('CREATE TABLE IF NOT EXISTS hf_tax_section');
    const second: string = normalize(calls[1][0]);
    expect(second).toContain('CREATE TABLE IF NOT EXISTS hf_category_tax_tag');
    expect(second).toContain('REFERENCES umsatztyp (id) ON UPDATE CASCADE ON DELETE CASCADE');
    expect(second).toContain(
      'REFERENCES hf_tax_section (code) ON UPDATE CASCADE ON DELETE RESTRICT',
    );
    expect(calls[2][0]).toBe('INSERT IGNORE INTO hf_tax_section (code) VALUES ?');
    expect(calls[2][1]).toEqual([TAX_TAG_CODES.map((code: string): string[] => [code])]);
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

describe('applyTaxTagChanges', () => {
  interface FakeConnection {
    beginTransaction: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
    commit: ReturnType<typeof vi.fn>;
    rollback: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
  }
  let connection: FakeConnection;

  beforeEach(() => {
    connection = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      query: vi.fn(),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
    };
    const pool: { getConnection: ReturnType<typeof vi.fn> } = {
      getConnection: vi.fn().mockResolvedValue(connection),
    };
    vi.mocked(getPool).mockReturnValue(pool as unknown as Pool);
  });

  const request: TaxTagsUpdateRequest = {
    changes: [
      { category_id: 9, expected: 'St-WK', next: 'St-0' },
      { category_id: 4, expected: null, next: 'St-SA' },
      { category_id: 6, expected: 'St-V', next: null },
    ],
  };

  it('inserts, deletes and updates in id order, then commits', async () => {
    connection.query.mockResolvedValue([{ affectedRows: 1 }]);

    expect(await applyTaxTagChanges(request)).toEqual({ result: 'saved' });

    const calls: [string, unknown[]][] = connection.query.mock.calls as [string, unknown[]][];
    expect(calls).toEqual([
      ['INSERT INTO hf_category_tax_tag (category_id, code) VALUES (?, ?)', [4, 'St-SA']],
      ['DELETE FROM hf_category_tax_tag WHERE category_id = ? AND code = ?', [6, 'St-V']],
      [
        'UPDATE hf_category_tax_tag SET code = ? WHERE category_id = ? AND code = ?',
        ['St-0', 9, 'St-WK'],
      ],
    ]);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back and reports every change that matched nothing', async () => {
    connection.query.mockResolvedValue([{ affectedRows: 0 }]);

    expect(await applyTaxTagChanges(request)).toEqual({
      result: 'conflict',
      conflictIds: [4, 6, 9],
    });
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it.each(['ER_DUP_ENTRY', 'ER_NO_REFERENCED_ROW_2'])(
    'treats %s as a conflict, not a failure',
    async (code: string) => {
      connection.query
        .mockRejectedValueOnce(Object.assign(new Error(code), { code }))
        .mockResolvedValue([{ affectedRows: 1 }]);

      expect(await applyTaxTagChanges(request)).toEqual({ result: 'conflict', conflictIds: [4] });
      expect(connection.rollback).toHaveBeenCalledTimes(1);
    },
  );

  it('rolls back, rethrows and releases on any other error', async () => {
    const error: Error = new Error('boom');
    connection.query.mockRejectedValue(error);

    await expect(applyTaxTagChanges(request)).rejects.toBe(error);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it('throws on an unexpected affected row count', async () => {
    connection.query.mockResolvedValue([{ affectedRows: 2 }]);

    await expect(applyTaxTagChanges(request)).rejects.toThrow('affected 2 rows');
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });
});
