import type { Pool } from 'mysql2/promise';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/pool', () => ({
  getPool: vi.fn(),
}));

import { getPool } from '../db/pool';
import { CATEGORY_COLUMNS, listCategories } from './umsatztyp';

interface FakePool {
  query: ReturnType<typeof vi.fn>;
}

function makeFakePool(): FakePool {
  return { query: vi.fn() };
}

describe('listCategories', () => {
  let pool: FakePool;

  beforeEach(() => {
    pool = makeFakePool();
    vi.mocked(getPool).mockReturnValue(pool as unknown as Pool);
  });

  it('selects every row unfiltered and unpaged, ordered by name and id', async () => {
    pool.query.mockResolvedValueOnce([[]]);

    await listCategories();

    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql] = pool.query.mock.calls[0] as [string];
    expect(sql).toContain('FROM umsatztyp');
    expect(sql).not.toContain('WHERE');
    expect(sql).not.toContain('LIMIT');
    expect(sql).toContain('ORDER BY name, id');
  });

  it('selects exactly the response columns, in response order', async () => {
    pool.query.mockResolvedValueOnce([[]]);

    await listCategories();

    const [sql] = pool.query.mock.calls[0] as [string];
    expect(sql).toContain(`SELECT ${CATEGORY_COLUMNS.join(', ')} FROM umsatztyp`);
  });

  it('returns the rows exactly as the database delivered them', async () => {
    const rows = [
      {
        id: 1,
        name: 'Groceries',
        nummer: null,
        pattern: null,
        isregex: null,
        umsatztyp: 0,
        parent_id: null,
        color: '#ff0000',
        customcolor: 1,
        kommentar: null,
        konto_id: null,
        konto_kategorie: null,
        flags: null,
      },
      {
        id: 2,
        name: 'Transport',
        nummer: null,
        pattern: null,
        isregex: null,
        umsatztyp: 0,
        parent_id: 1,
        color: null,
        customcolor: 0,
        kommentar: 'Fuel and tolls',
        konto_id: null,
        konto_kategorie: null,
        flags: null,
      },
    ];
    pool.query.mockResolvedValueOnce([rows]);

    const result = await listCategories();

    expect(result).toBe(rows);
  });
});
