import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import { categoryRow } from '../../../core/utils/testing/category-row-fixture';
import {
  colDef,
  type DataTableColDef,
  type DataTableVisibleColDef,
} from '../../../shared/components/data-table/data-table.model';
import { buildCategoryReport, type CategoryReportRow } from '../by-category/category-report';
import { transaction } from '../testing/transaction-fixture';
import { buildCategoryExport, maxCategoryDepth } from './category-export';
import type { ExportDepth, ExportDocument, ExportRow, ExportScope } from './export.model';

const SCOPE: ExportScope = { period: '2026', accounts: 'All', search: null };

const columns: readonly DataTableColDef<CategoryReportRow>[] = [
  colDef<CategoryReportRow, string | null>({
    colId: 'name',
    headerKey: 'transactions.byCategory.colName',
    valueGetter: (row: CategoryReportRow): string | null =>
      row.kind === 'transaction'
        ? row.transaction.empfaenger_name
        : (row.category?.name ?? 'Unassigned'),
  }),
  colDef<CategoryReportRow, string | null>({
    colId: 'datum',
    headerKey: 'transactions.colDate',
    valueGetter: (row: CategoryReportRow): string | null =>
      row.kind === 'transaction' ? row.transaction.datum : 'ignored',
  }),
  colDef<CategoryReportRow, number | null>({
    colId: 'betrag',
    headerKey: 'transactions.byCategory.colAmount',
    aggFunc: 'sum',
    valueGetter: (row: CategoryReportRow): number | null =>
      row.kind === 'category' ? 0 : row.transaction.betrag,
  }),
  colDef<CategoryReportRow, CategoryReportRow>({
    colId: 'order',
    hide: true,
    valueGetter: (row: CategoryReportRow): CategoryReportRow => row,
  }),
];

function rowsOf(categories: CategoryRow[], amounts: Record<number, number[]>): CategoryReportRow[] {
  const txs = Object.entries(amounts).flatMap(([categoryId, list]: [string, number[]]) =>
    list.map((betrag: number, index: number) => ({
      categoryId: Number(categoryId),
      tx: transaction({
        id: Number(categoryId) * 100 + index,
        betrag,
        empfaenger_name: `tx${categoryId}-${index}`,
      }),
    })),
  );
  const assignment = new Map<number, CategoryRow | null>(
    txs.map((entry): [number, CategoryRow | null] => [
      entry.tx.id,
      categories.find((c: CategoryRow) => c.id === entry.categoryId) ?? null,
    ]),
  );
  return buildCategoryReport({
    transactions: txs.map((entry) => entry.tx),
    assignment,
    categories,
  });
}

// A (1) -> B (2) -> C (3); D (4) top level.
const categories: CategoryRow[] = [
  categoryRow({ id: 1, name: 'A' }),
  categoryRow({ id: 2, name: 'B', parent_id: 1 }),
  categoryRow({ id: 3, name: 'C', parent_id: 2 }),
  categoryRow({ id: 4, name: 'D' }),
];
const rows: CategoryReportRow[] = rowsOf(categories, { 3: [-10, -5], 1: [-1], 0: [7] });

function build(depth: ExportDepth, cols = columns): ExportDocument {
  return buildCategoryExport({
    rows,
    columns: cols,
    depth,
    labels: {
      title: 'Report',
      scope: SCOPE,
      header: (column: DataTableVisibleColDef<CategoryReportRow, unknown>): string =>
        `h:${column.colId}`,
      total: 'Total',
    },
  });
}

function names(doc: ExportDocument): (string | number | null)[] {
  return doc.rows.map((row: ExportRow) => row.cells[0]);
}

describe('buildCategoryExport', () => {
  it('exports visible columns in order with kinds and translated headers', () => {
    const doc: ExportDocument = build('all');
    expect(doc.columns).toEqual([
      { id: 'name', header: 'h:name', kind: 'text' },
      { id: 'datum', header: 'h:datum', kind: 'text' },
      { id: 'betrag', header: 'h:betrag', kind: 'amount' },
    ]);
  });

  it('drops transaction-only columns when transactions are cut off', () => {
    for (const depth of [1, 2]) {
      const doc: ExportDocument = build(depth);
      expect(doc.columns.map((column) => column.id)).toEqual(['name', 'betrag']);
      expect(doc.rows.every((row: ExportRow) => row.cells.length === 2)).toBe(true);
    }
    expect(build('all').columns.map((column) => column.id)).toEqual(['name', 'datum', 'betrag']);
  });

  it('depth 1 lists top-level categories only, unassigned last, plus total', () => {
    const doc: ExportDocument = build(1);
    expect(names(doc)).toEqual(['A', 'Unassigned', 'Total']);
    expect(doc.rows.map((row: ExportRow) => row.kind)).toEqual(['category', 'category', 'total']);
  });

  it('depth 2 adds second-level categories, no transactions', () => {
    const doc: ExportDocument = build(2);
    expect(names(doc)).toEqual(['A', 'B', 'Unassigned', 'Total']);
    expect(doc.rows.map((row: ExportRow) => row.level)).toEqual([0, 1, 0, 0]);
  });

  it("'all' adds every category and transaction", () => {
    const doc: ExportDocument = build('all');
    expect(names(doc)).toEqual([
      'A',
      'B',
      'C',
      'tx3-1',
      'tx3-0',
      'tx1-0',
      'Unassigned',
      'tx0-0',
      'Total',
    ]);
    const tx: ExportRow = doc.rows[3];
    expect(tx.kind).toBe('transaction');
    expect(tx.level).toBe(3);
    expect(tx.cells).toEqual(['tx3-1', '2026-09-01', -5]);
  });

  it('category sums include descendants hidden by the depth; text cells are null', () => {
    const doc: ExportDocument = build(1);
    expect(doc.rows[0].cells).toEqual(['A', -16]);
    expect(doc.rows[1].cells).toEqual(['Unassigned', 7]);
  });

  it('total row sums the roots', () => {
    const doc: ExportDocument = build(1);
    expect(doc.rows[doc.rows.length - 1]).toEqual({
      kind: 'total',
      level: 0,
      cells: ['Total', -9],
    });
  });

  it('throws on an invalid depth', () => {
    for (const depth of [0, -1, 1.5, Number.NaN]) {
      expect(() => build(depth)).toThrow(/depth/);
    }
  });
});

describe('maxCategoryDepth', () => {
  it('is the deepest category nesting', () => {
    expect(maxCategoryDepth(rows)).toBe(3);
  });

  it('counts the unassigned node as top level', () => {
    expect(maxCategoryDepth(rowsOf([], {}))).toBe(1);
  });

  it('is 0 without rows', () => {
    expect(maxCategoryDepth([])).toBe(0);
  });
});
