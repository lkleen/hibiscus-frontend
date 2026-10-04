import type { TreeNode } from 'primeng/api';
import { buildTree, type TreeBranch } from '../../../core/utils/build-tree';
import { getRawRow } from './column-accessor-proxy';
import { defaultValueGetter } from './data-table.defaults';
import { isVisibleColumn } from './data-table.model';
import type { DataTableColDef, DataTableOptions, DataTableTreeOptions } from './data-table.model';

/** ag-Grid's `groupDefaultExpanded` default: every level starts expanded. */
export const DEFAULT_GROUP_EXPANDED = -1;

/** What `toTreeNodes` needs: the tree keys, how to represent a row as node data, and how many
 *  levels start expanded (see `DataTableTreeData.groupDefaultExpanded`). */
export interface TreeNodesConfig<Row, Data> {
  readonly getId: (row: Row) => string | number;
  readonly getParentId: (row: Row) => string | number | null;
  readonly getData: (row: Row) => Data;
  readonly groupDefaultExpanded: number;
  /** The nodes of the previous build by key (`indexTreeNodes`; empty on the first build). A row
   *  whose key is in it reuses that node object instead of getting a new one. */
  readonly previous: ReadonlyMap<string, TreeNode<Data>>;
}

/** Everything `validateTreeMode` checks a tree-mode table against. */
export interface TreeModeParams<Row> {
  readonly options: DataTableTreeOptions<Row>;
  readonly columns: readonly DataTableColDef<Row, unknown>[];
  readonly externalFilter: ((row: Row) => boolean) | null;
}

/** Whether a node at `depth` (0 = root) starts expanded under `groupDefaultExpanded`. */
export function isExpandedAtDepth(groupDefaultExpanded: number, depth: number): boolean {
  return groupDefaultExpanded === -1 || depth < groupDefaultExpanded;
}

/** Every node of the forest by its `key`, for the next `toTreeNodes` pass. Throws on a node
 *  without a key. */
export function indexTreeNodes<Data>(
  roots: readonly TreeNode<Data>[],
): Map<string, TreeNode<Data>> {
  const index = new Map<string, TreeNode<Data>>();
  const visit = (node: TreeNode<Data>): void => {
    if (node.key === undefined) throw new Error('data-table: tree node without key');
    index.set(node.key, node);
    node.children?.forEach(visit);
  };
  roots.forEach(visit);
  return index;
}

/**
 * Builds PrimeNG `TreeNode`s from flat rows through `buildTree` (dangling parent → root; throws on
 * a duplicate id or a cycle). Roots and siblings keep the input order. The row itself never lands
 * on the node as a copy: `getData` decides what `node.data` is (the table passes a column-accessor
 * proxy of the raw row).
 *
 * Reconciles by key against `config.previous` (ag-Grid's `getRowId` update model): a key present
 * before keeps its node object, with `data` and `children` replaced and `expanded` untouched (it is
 * the node's own state, which PrimeNG mutates on toggle); a new key gets a new node with the
 * `groupDefaultExpanded` default for its depth; a key that is gone is simply not in the result. The
 * previous nodes are mutated, and every `children` array is rebuilt, so the caller may sort the
 * returned forest in place.
 */
export function toTreeNodes<Row, Data>(
  rows: readonly Row[],
  config: TreeNodesConfig<Row, Data>,
): TreeNode<Data>[] {
  const toNode = (branch: TreeBranch<Row>, depth: number): TreeNode<Data> => {
    const key = String(config.getId(branch.row));
    const data: Data = config.getData(branch.row);
    const children: TreeNode<Data>[] = branch.children.map((child: TreeBranch<Row>) =>
      toNode(child, depth + 1),
    );
    const existing: TreeNode<Data> | undefined = config.previous.get(key);
    if (existing) {
      existing.data = data;
      existing.children = children;
      return existing;
    }
    return {
      key,
      data,
      expanded: isExpandedAtDepth(config.groupDefaultExpanded, depth),
      children,
    };
  };
  return buildTree(rows, config).map((root: TreeBranch<Row>) => toNode(root, 0));
}

/**
 * Sorts `nodes` and, recursively, every node's children in place, always within one level (a
 * child never leaves its parent). Idempotent, so it is safe for PrimeNG's `customSort` to call it
 * several times with the same root array.
 */
export function sortTreeNodes<Data>(
  nodes: TreeNode<Data>[],
  compare: (a: Data, b: Data) => number,
): void {
  nodes.sort((a: TreeNode<Data>, b: TreeNode<Data>) =>
    compare(requireNodeData(a), requireNodeData(b)),
  );
  for (const node of nodes) {
    if (node.children) sortTreeNodes(node.children, compare);
  }
}

export function requireNodeData<Data>(node: TreeNode<Data>): Data {
  if (node.data === undefined) throw new Error('data-table: tree node without data');
  return node.data;
}

/**
 * Throws on every option combination tree mode does not support (see `DataTableTreeOptions`), so
 * a misconfiguration fails on first render instead of showing a subtly wrong table.
 */
export function validateTreeMode<Row>(params: TreeModeParams<Row>): void {
  const { options, columns, externalFilter } = params;
  const { groupColId, groupDefaultExpanded } = options.treeData;

  const groupColumn: DataTableColDef<Row, unknown> | undefined = columns.find(
    (column: DataTableColDef<Row, unknown>) => column.colId === groupColId,
  );
  if (!groupColumn) {
    throw new Error(`data-table: treeData.groupColId "${groupColId}" is not a column`);
  }
  if (!isVisibleColumn(groupColumn)) {
    throw new Error(`data-table: treeData.groupColId "${groupColId}" is a hidden column`);
  }
  if (
    groupDefaultExpanded !== undefined &&
    (!Number.isInteger(groupDefaultExpanded) || groupDefaultExpanded < -1)
  ) {
    throw new Error(
      `data-table: treeData.groupDefaultExpanded must be an integer >= -1, got ${groupDefaultExpanded}`,
    );
  }
  for (const column of columns) {
    if (isVisibleColumn(column) && (column.filter === 'numeric' || column.filter === 'date')) {
      throw new Error(
        `data-table: column "${column.colId}" has a ${column.filter} filter, which tree mode does not support (text only)`,
      );
    }
  }
  // Runtime check for callers that bypass the `pagination?: false` type.
  if (options.pagination !== undefined && options.pagination !== false) {
    throw new Error('data-table: tree mode does not support pagination');
  }
  if (externalFilter !== null) {
    throw new Error('data-table: tree mode does not support externalFilter');
  }
}

/** Throws when a column declares `aggFunc` but the table is not in tree mode. */
export function validateNoAggFuncOutsideTreeMode<Row>(
  options: DataTableOptions<Row>,
  columns: readonly DataTableColDef<Row, unknown>[],
): void {
  if (options.treeData !== undefined) return;
  const aggColumn: DataTableColDef<Row, unknown> | undefined = columns.find(
    (column: DataTableColDef<Row, unknown>) => column.aggFunc !== undefined,
  );
  if (aggColumn) {
    throw new Error(
      `data-table: column "${aggColumn.colId}" has aggFunc, which requires tree mode (options.treeData)`,
    );
  }
}

/** Per group node (keyed by its raw row), the aggregate of each `aggFunc` column by colId. */
export type TreeAggregates<Row> = ReadonlyMap<Row, ReadonlyMap<string, number>>;

/**
 * Computes `aggFunc: 'sum'` for every node with children: the sum of its descendant leaves'
 * `valueGetter` values (`null`/`undefined` skipped, any other non-number throws, no numeric
 * leaves = 0). Leaves have no entry (they show their own value). One post-order pass. The result
 * is keyed by the *raw* row (`getRawRow`), so proxied and raw rows resolve alike.
 */
export function computeTreeAggregates<Row>(
  nodes: readonly TreeNode<Row>[],
  columns: readonly DataTableColDef<Row, unknown>[],
): TreeAggregates<Row> {
  const aggColumns: DataTableColDef<Row, unknown>[] = columns.filter(
    (column: DataTableColDef<Row, unknown>) => column.aggFunc === 'sum',
  );
  const result = new Map<Row, ReadonlyMap<string, number>>();
  if (aggColumns.length === 0) return result;

  const leafValue = (column: DataTableColDef<Row, unknown>, raw: Row): number => {
    const valueGetter: (row: Row) => unknown =
      column.valueGetter ?? defaultValueGetter<Row>(column.colId);
    const value: unknown = valueGetter(raw);
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return value;
    throw new Error(
      `data-table: aggFunc 'sum' of column "${column.colId}" needs numbers, got ${typeof value}`,
    );
  };

  const visit = (node: TreeNode<Row>): ReadonlyMap<string, number> => {
    const raw: Row = getRawRow(requireNodeData(node));
    const sums = new Map<string, number>();
    if (!node.children || node.children.length === 0) {
      for (const column of aggColumns) sums.set(column.colId, leafValue(column, raw));
      return sums;
    }
    for (const column of aggColumns) sums.set(column.colId, 0);
    for (const child of node.children) {
      const childSums: ReadonlyMap<string, number> = visit(child);
      for (const column of aggColumns) {
        sums.set(column.colId, (sums.get(column.colId) ?? 0) + (childSums.get(column.colId) ?? 0));
      }
    }
    result.set(raw, sums);
    return sums;
  };
  for (const root of nodes) visit(root);
  return result;
}
