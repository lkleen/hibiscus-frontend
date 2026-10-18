import type { Pool } from 'mysql2/promise';
import type {
  CategoryEditableFields,
  CategoryRow,
  CategoryUpdateRequest,
} from '@hibiscus-frontend/shared/contracts/categories';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/pool', () => ({
  getPool: vi.fn(),
}));

import { getPool } from '../db/pool';
import {
  CATEGORY_COLUMNS,
  CATEGORY_EDITABLE_COLUMNS,
  createCategory,
  listCategories,
  updateCategory,
} from './umsatztyp';

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

interface FakeConnection {
  query: ReturnType<typeof vi.fn>;
  beginTransaction: ReturnType<typeof vi.fn>;
  commit: ReturnType<typeof vi.fn>;
  rollback: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
}

const fields: CategoryEditableFields = {
  name: 'Food',
  nummer: null,
  pattern: null,
  isregex: null,
  umsatztyp: 0,
  parent_id: 1,
  color: null,
  customcolor: 0,
  kommentar: null,
  konto_id: null,
  konto_kategorie: null,
  flags: null,
};
const request: CategoryUpdateRequest = { expected: fields, next: { ...fields, parent_id: 3 } };

describe('CATEGORY_EDITABLE_COLUMNS', () => {
  it('is the selected columns without id', () => {
    expect(CATEGORY_EDITABLE_COLUMNS).toEqual(CATEGORY_COLUMNS.filter((c) => c !== 'id'));
  });
});

describe('createCategory', () => {
  it('inserts the editable columns and returns the row read back by insertId', async () => {
    const pool: FakePool = makeFakePool();
    vi.mocked(getPool).mockReturnValue(pool as unknown as Pool);
    const stored: CategoryRow = { id: 9, ...fields };
    pool.query.mockResolvedValueOnce([{ insertId: 9 }]).mockResolvedValueOnce([[stored]]);

    const result: CategoryRow = await createCategory(fields);

    const [insertSql, values] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(insertSql).toContain(`INSERT INTO umsatztyp (${CATEGORY_EDITABLE_COLUMNS.join(', ')})`);
    expect(values).toEqual(CATEGORY_EDITABLE_COLUMNS.map((c) => fields[c]));
    expect(pool.query.mock.calls[1]?.[1]).toEqual([9]);
    expect(result).toBe(stored);
  });

  it('throws when the row cannot be read back', async () => {
    const pool: FakePool = makeFakePool();
    vi.mocked(getPool).mockReturnValue(pool as unknown as Pool);
    pool.query.mockResolvedValueOnce([{ insertId: 9 }]).mockResolvedValueOnce([[]]);

    await expect(createCategory(fields)).rejects.toThrow('could not be read back');
  });
});

describe('updateCategory', () => {
  let connection: FakeConnection;

  function mockTree(tree: { id: number; parent_id: number | null }[]): void {
    connection.query.mockResolvedValueOnce([tree]);
  }

  beforeEach(() => {
    connection = {
      query: vi.fn(),
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
    };
    vi.mocked(getPool).mockReturnValue({
      getConnection: vi.fn().mockResolvedValue(connection),
    } as unknown as Pool);
  });

  it('updates with a <=> guard on every editable column and commits', async () => {
    mockTree([
      { id: 1, parent_id: null },
      { id: 2, parent_id: 1 },
      { id: 3, parent_id: null },
    ]);
    connection.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

    expect(await updateCategory(2, request)).toBe('updated');

    expect(connection.query.mock.calls[0]?.[0]).toContain('FOR UPDATE');
    const [sql, values] = connection.query.mock.calls[1] as [string, unknown[]];
    for (const column of CATEGORY_EDITABLE_COLUMNS) {
      expect(sql).toContain(`${column} = ?`);
      expect(sql).toContain(`${column} <=> ?`);
    }
    expect(values).toHaveLength(CATEGORY_EDITABLE_COLUMNS.length * 2 + 1);
    expect(values[CATEGORY_EDITABLE_COLUMNS.length]).toBe(2);
    expect(connection.commit).toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalled();
  });

  it('returns not-found when the id is missing', async () => {
    mockTree([{ id: 1, parent_id: null }]);

    expect(await updateCategory(2, request)).toBe('not-found');
    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalled();
  });

  it('returns cycle when the new parent is the row itself', async () => {
    mockTree([{ id: 2, parent_id: null }]);

    const result = await updateCategory(2, { ...request, next: { ...fields, parent_id: 2 } });

    expect(result).toBe('cycle');
    expect(connection.query).toHaveBeenCalledTimes(1);
  });

  it('returns cycle when the new parent is a descendant', async () => {
    mockTree([
      { id: 2, parent_id: null },
      { id: 3, parent_id: 2 },
      { id: 4, parent_id: 3 },
    ]);

    const result = await updateCategory(2, { ...request, next: { ...fields, parent_id: 4 } });

    expect(result).toBe('cycle');
    expect(connection.rollback).toHaveBeenCalled();
  });

  it('returns conflict when nothing matched', async () => {
    mockTree([{ id: 2, parent_id: null }]);
    connection.query.mockResolvedValueOnce([{ affectedRows: 0 }]);

    expect(await updateCategory(2, { ...request, next: { ...fields, parent_id: null } })).toBe(
      'conflict',
    );
    expect(connection.rollback).toHaveBeenCalled();
  });

  it('rolls back, releases and rethrows on a database error', async () => {
    mockTree([{ id: 2, parent_id: null }]);
    connection.query.mockRejectedValueOnce(new Error('boom'));

    await expect(
      updateCategory(2, { ...request, next: { ...fields, parent_id: null } }),
    ).rejects.toThrow('boom');
    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalled();
  });
});
