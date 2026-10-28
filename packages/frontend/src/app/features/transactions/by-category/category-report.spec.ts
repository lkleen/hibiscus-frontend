import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import { categoryRow } from '../../../core/utils/testing/category-row-fixture';
import { transaction } from '../testing/transaction-fixture';
import {
  buildCategoryReport,
  compareReportRows,
  filterReportByTaxSections,
  type CategoryReportRow,
} from './category-report';

function build(
  transactions: TransactionRow[],
  categories: CategoryRow[],
  assigned: Record<number, number | null>,
): CategoryReportRow[] {
  const assignment = new Map<number, CategoryRow | null>(
    transactions.map((t: TransactionRow): [number, CategoryRow | null] => {
      const id: number | null | undefined = assigned[t.id];
      if (id === undefined) return [t.id, null];
      return [t.id, id === null ? null : (categories.find((c) => c.id === id) ?? null)];
    }),
  );
  return buildCategoryReport({ transactions, assignment, categories });
}

function ids(rows: CategoryReportRow[]): string[] {
  return rows.map((row: CategoryReportRow) => row.id).sort();
}

describe('buildCategoryReport', () => {
  it('always has the unassigned node, even without transactions', () => {
    const rows: CategoryReportRow[] = build([], [categoryRow({ id: 1 })], {});
    expect(rows).toEqual([{ kind: 'category', id: 'c-none', parentId: null, category: null }]);
  });

  it('includes categories with transactions and their ancestors only', () => {
    const categories: CategoryRow[] = [
      categoryRow({ id: 1, name: 'Root' }),
      categoryRow({ id: 2, name: 'Child', parent_id: 1 }),
      categoryRow({ id: 3, name: 'Empty' }),
    ];
    const rows: CategoryReportRow[] = build([transaction({ id: 10 })], categories, { 10: 2 });
    expect(ids(rows)).toEqual(['c-none', 'c1', 'c2', 't10']);
    expect(rows.find((r) => r.id === 'c2')?.parentId).toBe('c1');
    expect(rows.find((r) => r.id === 'c1')?.parentId).toBeNull();
    expect(rows.find((r) => r.id === 't10')?.parentId).toBe('c2');
  });

  it('puts unassigned transactions under the pseudo-node', () => {
    const rows: CategoryReportRow[] = build([transaction({ id: 5 })], [], { 5: null });
    expect(rows.find((r) => r.id === 't5')?.parentId).toBe('c-none');
  });

  it('drops skip-in-reports categories, their descendants and all their transactions', () => {
    const categories: CategoryRow[] = [
      categoryRow({ id: 1, flags: 1 }),
      categoryRow({ id: 2, parent_id: 1 }),
      categoryRow({ id: 3 }),
    ];
    const rows: CategoryReportRow[] = build(
      [transaction({ id: 1 }), transaction({ id: 2 }), transaction({ id: 3 })],
      categories,
      { 1: 1, 2: 2, 3: 3 },
    );
    expect(ids(rows)).toEqual(['c-none', 'c3', 't3']);
  });

  it('throws when a transaction is missing from the assignment', () => {
    expect(() =>
      buildCategoryReport({ transactions: [transaction()], assignment: new Map(), categories: [] }),
    ).toThrow();
  });
});

describe('compareReportRows', () => {
  const cat = (id: number, name: string, nummer: string | null = null): CategoryReportRow => ({
    kind: 'category',
    id: `c${id}`,
    parentId: null,
    category: categoryRow({ id, name, nummer }),
  });
  const unassigned: CategoryReportRow = {
    kind: 'category',
    id: 'c-none',
    parentId: null,
    category: null,
  };
  const tx = (id: number, datum: string): CategoryReportRow => ({
    kind: 'transaction',
    id: `t${id}`,
    parentId: 'c1',
    transaction: transaction({ id, datum }),
  });

  it('sorts categories by number then name, unassigned last, before transactions', () => {
    const sorted: string[] = [tx(1, '2026-01-01'), unassigned, cat(2, 'B'), cat(1, 'A', '2')]
      .sort(compareReportRows)
      .map((row: CategoryReportRow) => row.id);
    expect(sorted).toEqual(['c2', 'c1', 'c-none', 't1']);
  });

  it('sorts transactions newest first', () => {
    const sorted: string[] = [tx(1, '2026-01-01'), tx(2, '2026-02-01')]
      .sort(compareReportRows)
      .map((row: CategoryReportRow) => row.id);
    expect(sorted).toEqual(['t2', 't1']);
  });
});

describe('filterReportByTaxSections', () => {
  const categories: CategoryRow[] = [
    categoryRow({ id: 1, name: 'Root' }),
    categoryRow({ id: 2, name: 'Tax child', parent_id: 1 }),
    categoryRow({ id: 3, name: 'Other child', parent_id: 1 }),
    categoryRow({ id: 4, name: 'Elsewhere' }),
  ];
  const transactions: TransactionRow[] = [
    transaction({ id: 10 }),
    transaction({ id: 11 }),
    transaction({ id: 12 }),
    transaction({ id: 13 }),
    transaction({ id: 14 }),
  ];
  const rows: CategoryReportRow[] = build(transactions, categories, {
    10: 2,
    11: 3,
    12: 1,
    13: 4,
    14: null,
  });
  const keepIds =
    (...kept: number[]) =>
    (category: CategoryRow): boolean =>
      kept.includes(category.id);

  it('keeps the transactions of passing categories with all their ancestors', () => {
    const filtered: CategoryReportRow[] = filterReportByTaxSections({ rows, keep: keepIds(2) });
    expect(ids(filtered)).toEqual(['c1', 'c2', 't10']);
  });

  it('drops the own transactions of a kept ancestor that does not pass', () => {
    const filtered: CategoryReportRow[] = filterReportByTaxSections({ rows, keep: keepIds(2, 4) });
    expect(ids(filtered)).toEqual(['c1', 'c2', 'c4', 't10', 't13']);
    expect(ids(filtered)).not.toContain('t12');
  });

  it('keeps the own transactions of an ancestor that passes', () => {
    const filtered: CategoryReportRow[] = filterReportByTaxSections({ rows, keep: keepIds(1) });
    expect(ids(filtered)).toEqual(['c1', 't12']);
  });

  it('drops the unassigned node and unassigned transactions', () => {
    const filtered: CategoryReportRow[] = filterReportByTaxSections({ rows, keep: () => true });
    expect(ids(filtered)).not.toContain('c-none');
    expect(ids(filtered)).not.toContain('t14');
    expect(ids(filtered)).toEqual(['c1', 'c2', 'c3', 'c4', 't10', 't11', 't12', 't13']);
  });

  it('is empty when no category passes', () => {
    expect(filterReportByTaxSections({ rows, keep: () => false })).toEqual([]);
  });

  it('throws when a transaction points to a missing category row', () => {
    const broken: CategoryReportRow[] = rows.filter((row) => row.id !== 'c4');
    expect(() => filterReportByTaxSections({ rows: broken, keep: () => true })).toThrow(/c4/);
  });
});
