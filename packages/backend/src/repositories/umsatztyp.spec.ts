import type { Pool } from 'mysql2/promise';
import type {
  CategoryCreateRequest,
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
const request: CategoryUpdateRequest = {
  expected: fields,
  next: { ...fields, parent_id: 3 },
  taxTag: { expected: null, next: null },
};

describe('CATEGORY_EDITABLE_COLUMNS', () => {
  it('is the selected columns without id', () => {
    expect(CATEGORY_EDITABLE_COLUMNS).toEqual(CATEGORY_COLUMNS.filter((c) => c !== 'id'));
  });
});

describe('createCategory', () => {
  let connection: FakeConnection;
  const untagged: CategoryCreateRequest = { ...fields, taxTag: null };

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

  it('inserts the editable columns, reads the row back by insertId and commits', async () => {
    const stored: CategoryRow = { id: 9, ...fields };
    connection.query.mockResolvedValueOnce([{ insertId: 9 }]).mockResolvedValueOnce([[stored]]);

    const result: CategoryRow = await createCategory(untagged);

    const [insertSql, values] = connection.query.mock.calls[0] as [string, unknown[]];
    expect(insertSql).toContain(`INSERT INTO umsatztyp (${CATEGORY_EDITABLE_COLUMNS.join(', ')})`);
    expect(values).toEqual(CATEGORY_EDITABLE_COLUMNS.map((c) => fields[c]));
    expect(connection.query.mock.calls[1]?.[1]).toEqual([9]);
    expect(connection.query).toHaveBeenCalledTimes(2);
    expect(connection.commit).toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalled();
    expect(result).toBe(stored);
  });

  it('inserts the tax tag in the same transaction when one is given', async () => {
    const stored: CategoryRow = { id: 9, ...fields };
    connection.query
      .mockResolvedValueOnce([{ insertId: 9 }])
      .mockResolvedValueOnce([[]]) // tag SELECT ... FOR UPDATE
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[stored]]);

    await createCategory({ ...untagged, taxTag: 'St-WK' });

    expect(connection.query.mock.calls[2]).toEqual([
      'INSERT INTO hf_category_tax_tag (category_id, code) VALUES (?, ?)',
      [9, 'St-WK'],
    ]);
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  it('rolls back and rethrows when the tag insert fails (unknown section)', async () => {
    const error: Error = Object.assign(new Error('fk_hf_tax_tag_section'), {
      code: 'ER_NO_REFERENCED_ROW_2',
    });
    connection.query
      .mockResolvedValueOnce([{ insertId: 9 }])
      .mockResolvedValueOnce([[]])
      .mockRejectedValueOnce(error);

    await expect(createCategory({ ...untagged, taxTag: 'St-X' })).rejects.toBe(error);
    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalled();
  });

  it('throws and rolls back when the row cannot be read back', async () => {
    connection.query.mockResolvedValueOnce([{ insertId: 9 }]).mockResolvedValueOnce([[]]);

    await expect(createCategory(untagged)).rejects.toThrow('could not be read back');
    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
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
    connection.query.mockResolvedValueOnce([{ affectedRows: 1 }]).mockResolvedValueOnce([[]]); // tag SELECT: untagged, expected untagged

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

  it('updates the tax tag in the same transaction', async () => {
    mockTree([{ id: 2, parent_id: null }]);
    connection.query
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ category_id: 2, code: 'St-WK' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const result = await updateCategory(2, {
      ...request,
      next: { ...fields, parent_id: null },
      taxTag: { expected: 'St-WK', next: 'St-SA' },
    });

    expect(result).toBe('updated');
    expect(connection.query.mock.calls[3]).toEqual([
      'UPDATE hf_category_tax_tag SET code = ? WHERE category_id = ? AND code = ?',
      ['St-SA', 2, 'St-WK'],
    ]);
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  it('returns conflict and rolls back when the stored tax tag differs from expected', async () => {
    mockTree([{ id: 2, parent_id: null }]);
    connection.query
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ category_id: 2, code: 'St-V' }]]);

    const result = await updateCategory(2, {
      ...request,
      next: { ...fields, parent_id: null },
      taxTag: { expected: 'St-WK', next: 'St-SA' },
    });

    expect(result).toBe('conflict');
    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
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
