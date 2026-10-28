import type { Pool } from 'mysql2/promise';
import type { TaxSection } from '@hibiscus-frontend/shared/contracts/tax-tags';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/pool', () => ({
  getPool: vi.fn(),
}));

import { getPool } from '../db/pool';
import {
  TAX_SECTION_COLUMNS,
  createTaxSection,
  deleteTaxSection,
  listTaxSections,
  updateTaxSection,
} from './tax-section';

const section: TaxSection = {
  code: 'St-WK',
  name: 'Werbungskosten',
  form: null,
  belongs: 'Arbeitsmittel',
  excludes: null,
  receipts: null,
  note: null,
};

let pool: { query: ReturnType<typeof vi.fn> };

beforeEach(() => {
  pool = { query: vi.fn() };
  vi.mocked(getPool).mockReturnValue(pool as unknown as Pool);
});

describe('listTaxSections', () => {
  it('selects every column ordered by code, without St-0', async () => {
    pool.query.mockResolvedValueOnce([[section]]);

    expect(await listTaxSections()).toEqual([section]);

    const [sql, values] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain(`SELECT ${TAX_SECTION_COLUMNS.join(', ')} FROM hf_tax_section`);
    expect(sql).toContain('WHERE code <> ?');
    expect(sql).toContain('ORDER BY code');
    expect(values).toEqual(['St-0']);
  });
});

describe('createTaxSection', () => {
  it('inserts all columns and returns the stored row', async () => {
    pool.query.mockResolvedValueOnce([{}]).mockResolvedValueOnce([[section]]);

    expect(await createTaxSection(section)).toBe(section);

    const [sql, values] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO hf_tax_section');
    expect(values).toEqual(TAX_SECTION_COLUMNS.map((c: keyof TaxSection) => section[c]));
  });

  it('throws when the row cannot be read back', async () => {
    pool.query.mockResolvedValueOnce([{}]).mockResolvedValueOnce([[]]);

    await expect(createTaxSection(section)).rejects.toThrow('could not be read back');
  });
});

describe('updateTaxSection', () => {
  const next: TaxSection = { ...section, code: 'St-X', note: 'n' };

  it('guards the update with <=> on every column', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

    expect(await updateTaxSection(section, next)).toBe('updated');

    const [sql, values] = pool.query.mock.calls[0] as [string, unknown[]];
    for (const column of TAX_SECTION_COLUMNS) {
      expect(sql).toContain(`${column} = ?`);
      expect(sql).toContain(`${column} <=> ?`);
    }
    expect(values).toEqual([
      ...TAX_SECTION_COLUMNS.map((c: keyof TaxSection) => next[c]),
      ...TAX_SECTION_COLUMNS.map((c: keyof TaxSection) => section[c]),
    ]);
  });

  it('returns conflict when nothing matched', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 0 }]);

    expect(await updateTaxSection(section, next)).toBe('conflict');
  });

  it('throws on an unexpected affected row count', async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 2 }]);

    await expect(updateTaxSection(section, next)).rejects.toThrow('affected 2 rows');
  });
});

describe('deleteTaxSection', () => {
  it('reports whether a row was deleted and never touches St-0', async () => {
    pool.query
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 0 }]);

    expect(await deleteTaxSection('St-WK')).toBe(true);
    expect(await deleteTaxSection('St-nope')).toBe(false);
    expect(pool.query.mock.calls[0]?.[0]).toContain('code <> ?');
  });
});
