/**
 * A tree node containing the original row data and its children.
 */
export interface TreeBranch<Row> {
  readonly row: Row;
  readonly children: TreeBranch<Row>[];
}

/**
 * Accessor functions to extract id and parent id from a row type.
 */
export interface TreeKeys<Row> {
  readonly getId: (row: Row) => string | number;
  readonly getParentId: (row: Row) => string | number | null;
}

/**
 * Builds a tree structure from a flat list of rows.
 *
 * Root nodes are those with a parent id of `null`, or whose declared parent is not present
 * in the input. Dangling references are treated as roots, never dropped.
 *
 * Throws `Error` if:
 * - A row has a duplicate id (the same id appears twice).
 * - A cycle is detected (a row cannot be reached from any root, indicating A→B→A or
 *   self-parent patterns). The error message includes the ids of unreachable rows.
 *
 * Siblings and roots preserve input order.
 *
 * @param rows The flat list of rows to organize into a tree.
 * @param keys Accessor functions to extract id and parent id from each row.
 * @returns An array of root tree branches.
 * @throws Error if a duplicate id or cycle is detected.
 */
export function buildTree<Row>(rows: readonly Row[], keys: TreeKeys<Row>): TreeBranch<Row>[] {
  const nodesById = new Map<string | number, TreeBranch<Row>>();
  const rowsById = new Map<string | number, Row>();

  // Build nodes and detect duplicate ids
  for (const row of rows) {
    const id: string | number = keys.getId(row);
    if (rowsById.has(id)) {
      throw new Error(`buildTree: duplicate id ${id}`);
    }
    rowsById.set(id, row);
    nodesById.set(id, { row, children: [] });
  }

  const roots: TreeBranch<Row>[] = [];
  const reachableIds = new Set<string | number>();

  // Build parent-child relationships
  for (const row of rows) {
    const id: string | number = keys.getId(row);
    const node: TreeBranch<Row> | undefined = nodesById.get(id);

    if (!node) {
      throw new Error(`buildTree: missing node for id ${id}`);
    }

    const parentId: string | number | null = keys.getParentId(row);
    const parent: TreeBranch<Row> | undefined =
      parentId === null ? undefined : nodesById.get(parentId);

    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Detect cycles: mark all reachable nodes from roots
  const markReachable = (branch: TreeBranch<Row>): void => {
    const id: string | number = keys.getId(branch.row);
    reachableIds.add(id);
    for (const child of branch.children) {
      if (!reachableIds.has(keys.getId(child.row))) {
        markReachable(child);
      }
    }
  };

  for (const root of roots) {
    markReachable(root);
  }

  // If not all rows are reachable, a cycle exists
  if (reachableIds.size < rows.length) {
    const unreachableIds: (string | number)[] = [];
    for (const row of rows) {
      const id: string | number = keys.getId(row);
      if (!reachableIds.has(id)) {
        unreachableIds.push(id);
      }
    }
    throw new Error(`buildTree: cycle detected; unreachable ids: ${unreachableIds.join(', ')}`);
  }

  return roots;
}
