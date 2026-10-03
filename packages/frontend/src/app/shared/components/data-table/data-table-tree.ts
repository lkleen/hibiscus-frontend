import type { TreeNode } from 'primeng/api';
import { buildTree, type TreeBranch } from '../../../core/utils/build-tree';
import { isVisibleColumn } from './data-table.model';
import type { DataTableColDef, DataTableTreeOptions } from './data-table.model';

/** ag-Grid's `groupDefaultExpanded` default: every level starts expanded. */
export const DEFAULT_GROUP_EXPANDED = -1;

/** What `toTreeNodes` needs: the tree keys, how to represent a row as node data, and how many
 *  levels start expanded (see `DataTableTreeData.groupDefaultExpanded`). */
export interface TreeNodesConfig<Row, Data> {
  readonly getId: (row: Row) => string | number;
  readonly getParentId: (row: Row) => string | number | null;
  readonly getData: (row: Row) => Data;
  readonly groupDefaultExpanded: number;
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

/**
 * Builds PrimeNG `TreeNode`s from flat rows through `buildTree` (dangling parent → root; throws on
 * a duplicate id or a cycle). Roots and siblings keep the input order. The row itself never lands
 * on the node as a copy: `getData` decides what `node.data` is (the table passes a column-accessor
 * proxy of the raw row).
 */
export function toTreeNodes<Row, Data>(
  rows: readonly Row[],
  config: TreeNodesConfig<Row, Data>,
): TreeNode<Data>[] {
  const toNode = (branch: TreeBranch<Row>, depth: number): TreeNode<Data> => ({
    key: String(config.getId(branch.row)),
    data: config.getData(branch.row),
    expanded: isExpandedAtDepth(config.groupDefaultExpanded, depth),
    children: branch.children.map((child: TreeBranch<Row>) => toNode(child, depth + 1)),
  });
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
