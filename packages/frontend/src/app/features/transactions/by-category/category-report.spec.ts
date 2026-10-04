import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import { categoryRow } from '../../../core/utils/testing/category-row-fixture';
import { transaction } from '../testing/transaction-fixture';
import { buildCategoryReport, type CategoryReportRow } from './category-report';

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
