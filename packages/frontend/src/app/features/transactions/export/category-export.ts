import type { TreeNode } from 'primeng/api';
import {
  computeTreeAggregates,
  requireNodeData,
  sortTreeNodes,
  toTreeNodes,
  type TreeAggregates,
} from '../../../shared/components/data-table/data-table-tree';
import { defaultValueGetter } from '../../../shared/components/data-table/data-table.defaults';
import {
  isVisibleColumn,
  type DataTableColDef,
  type DataTableVisibleColDef,
} from '../../../shared/components/data-table/data-table.model';
import { compareReportRows, type CategoryReportRow } from '../by-category/category-report';
import type {
  ExportCell,
  ExportColumn,
  ExportDepth,
  ExportDocument,
  ExportRow,
  ExportScope,
} from './export.model';

export interface CategoryExportLabels {
  readonly title: string;
  readonly scope: ExportScope;
  /** Translates a column's `headerKey`. */
  readonly header: (column: DataTableVisibleColDef<CategoryReportRow, unknown>) => string;
  readonly total: string;
}

export interface CategoryExportParams {
  readonly rows: readonly CategoryReportRow[];
  readonly columns: readonly DataTableColDef<CategoryReportRow>[];
  readonly depth: ExportDepth;
  readonly labels: CategoryExportLabels;
}

type ReportNode = TreeNode<CategoryReportRow>;

function buildSortedNodes(rows: readonly CategoryReportRow[]): ReportNode[] {
  const nodes: ReportNode[] = toTreeNodes<CategoryReportRow, CategoryReportRow>(rows, {
    getId: (row: CategoryReportRow): string => row.id,
    getParentId: (row: CategoryReportRow): string | null => row.parentId,
    getData: (row: CategoryReportRow): CategoryReportRow => row,
    groupDefaultExpanded: -1,
    previous: new Map<string, ReportNode>(),
  });
  sortTreeNodes(nodes, compareReportRows);
  return nodes;
}

function nodeDepth(node: ReportNode): number {
  const children: ReportNode[] = (node.children ?? []).filter(
    (child: ReportNode) => requireNodeData(child).kind === 'category',
  );
  return 1 + Math.max(0, ...children.map(nodeDepth));
}

/** The deepest category nesting: top level = 1 (the unassigned node counts as top level). */
export function maxCategoryDepth(rows: readonly CategoryReportRow[]): number {
  const roots: ReportNode[] = buildSortedNodes(rows).filter(
    (node: ReportNode) => requireNodeData(node).kind === 'category',
  );
  return Math.max(0, ...roots.map(nodeDepth));
}

function validateDepth(depth: ExportDepth): void {
  if (depth === 'all') return;
  if (typeof depth !== 'number' || !Number.isInteger(depth) || depth < 1) {
    throw new Error(`category export: depth must be an integer >= 1 or 'all', got ${depth}`);
  }
}

function readValue(column: DataTableColDef<CategoryReportRow>, row: CategoryReportRow): unknown {
  const getter: (row: CategoryReportRow) => unknown =
    column.valueGetter ?? defaultValueGetter<CategoryReportRow>(column.colId);
  return getter(row);
}

function toAmount(column: DataTableColDef<CategoryReportRow>, value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  throw new Error(`category export: column "${column.colId}" needs numbers, got ${typeof value}`);
}

function toText(column: DataTableColDef<CategoryReportRow>, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value === '' ? null : value;
  if (typeof value === 'number') return String(value);
  throw new Error(`category export: column "${column.colId}" needs text, got ${typeof value}`);
}

/** Turns the by-category tree into an export document with the table's order and sums. */
export function buildCategoryExport(params: CategoryExportParams): ExportDocument {
  const { rows, columns, depth, labels } = params;
  validateDepth(depth);

  const visible: DataTableVisibleColDef<CategoryReportRow, unknown>[] =
    columns.filter(isVisibleColumn);
  if (visible.length === 0) throw new Error('category export: no visible columns');
  const exportColumns: ExportColumn[] = visible.map(
    (column: DataTableVisibleColDef<CategoryReportRow, unknown>): ExportColumn => ({
      id: column.colId,
      header: labels.header(column),
      kind: column.aggFunc === 'sum' ? 'amount' : 'text',
    }),
  );

  const nodes: ReportNode[] = buildSortedNodes(rows);
  const aggregates: TreeAggregates<CategoryReportRow> = computeTreeAggregates(nodes, columns);

  const amountOf = (
    column: DataTableVisibleColDef<CategoryReportRow, unknown>,
    row: CategoryReportRow,
  ): number | null => {
    // A category without children is a leaf of the tree and shows its own value (0).
    const sum: number | undefined = aggregates.get(row)?.get(column.colId);
    return sum ?? toAmount(column, readValue(column, row));
  };

  const cellsOf = (row: CategoryReportRow): ExportCell[] =>
    visible.map((column: DataTableVisibleColDef<CategoryReportRow, unknown>, index: number) => {
      if (column.aggFunc === 'sum') {
        return row.kind === 'category'
          ? amountOf(column, row)
          : toAmount(column, readValue(column, row));
      }
      if (row.kind === 'category' && index > 0) return null;
      return toText(column, readValue(column, row));
    });

  const out: ExportRow[] = [];
  const walk = (node: ReportNode, level: number): void => {
    const row: CategoryReportRow = requireNodeData(node);
    if (row.kind === 'category') {
      out.push({ kind: 'category', level, cells: cellsOf(row) });
      if (depth !== 'all' && level + 1 >= depth) return;
    } else if (depth === 'all') {
      out.push({ kind: 'transaction', level, cells: cellsOf(row) });
    }
    for (const child of node.children ?? []) walk(child, level + 1);
  };
  nodes.forEach((node: ReportNode) => walk(node, 0));

  const totalCells: ExportCell[] = visible.map(
    (column: DataTableVisibleColDef<CategoryReportRow, unknown>, index: number) => {
      if (column.aggFunc === 'sum') {
        return nodes.reduce(
          (sum: number, node: ReportNode) => sum + (amountOf(column, requireNodeData(node)) ?? 0),
          0,
        );
      }
      return index === 0 ? labels.total : null;
    },
  );
  out.push({ kind: 'total', level: 0, cells: totalCells });

  // Drop text columns that stay empty in every non-total row (transaction-only columns when the
  // transactions are cut off); the name column and amount columns always stay.
  const keep: boolean[] = exportColumns.map(
    (column: ExportColumn, index: number): boolean =>
      index === 0 ||
      column.kind === 'amount' ||
      out.some((row: ExportRow) => row.kind !== 'total' && row.cells[index] !== null),
  );
  const pick = <T>(items: readonly T[]): T[] => items.filter((_: T, i: number) => keep[i]);
  return {
    title: labels.title,
    scope: labels.scope,
    columns: pick(exportColumns),
    rows: out.map((row: ExportRow): ExportRow => ({ ...row, cells: pick(row.cells) })),
  };
}
