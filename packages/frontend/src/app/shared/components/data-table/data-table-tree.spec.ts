import type { TreeNode } from 'primeng/api';
import { colDef } from './data-table.model';
import type { DataTableColDef, DataTableTreeData, DataTableTreeOptions } from './data-table.model';
import {
  computeTreeAggregates,
  sortTreeNodes,
  toTreeNodes,
  validateNoAggFuncOutsideTreeMode,
  validateTreeMode,
} from './data-table-tree';

interface Item {
  readonly id: number;
  readonly parentId: number | null;
  readonly name: string;
}

function item(id: number, parentId: number | null, name: string): Item {
  return { id, parentId, name };
}

/** A(1) > B(2) > D(4), A > C(3), Z(5). */
const ITEMS: readonly Item[] = [
  item(1, null, 'A'),
  item(2, 1, 'B'),
  item(3, 1, 'C'),
  item(4, 2, 'D'),
  item(5, null, 'Z'),
];

function nodes(groupDefaultExpanded: number, rows: readonly Item[] = ITEMS): TreeNode<Item>[] {
  return toTreeNodes<Item, Item>(rows, {
    getId: (row: Item): number => row.id,
    getParentId: (row: Item): number | null => row.parentId,
    getData: (row: Item): Item => row,
    groupDefaultExpanded,
  });
}

function expandedByName(list: readonly TreeNode<Item>[]): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  const visit = (node: TreeNode<Item>): void => {
    result[node.data?.name ?? '?'] = node.expanded === true;
    node.children?.forEach(visit);
  };
  list.forEach(visit);
  return result;
}

describe('toTreeNodes', () => {
  it('builds roots and children in input order, with the row as node data and the id as key', () => {
    const tree: TreeNode<Item>[] = nodes(-1);
    expect(tree.map((node: TreeNode<Item>) => node.data?.name)).toEqual(['A', 'Z']);
    expect(tree[0].key).toBe('1');
    expect(tree[0].data).toBe(ITEMS[0]);
    expect(tree[0].children?.map((node: TreeNode<Item>) => node.data?.name)).toEqual(['B', 'C']);
    expect(tree[0].children?.[0].children?.[0].data?.name).toBe('D');
  });

  it('groupDefaultExpanded -1 expands every level', () => {
    expect(expandedByName(nodes(-1))).toEqual({ A: true, B: true, D: true, C: true, Z: true });
  });

  it('groupDefaultExpanded 0 expands nothing', () => {
    expect(expandedByName(nodes(0))).toEqual({
      A: false,
      B: false,
      D: false,
      C: false,
      Z: false,
    });
  });

  it('groupDefaultExpanded 1 expands the first level only', () => {
    expect(expandedByName(nodes(1))).toEqual({ A: true, B: false, D: false, C: false, Z: true });
  });

  it('turns a row with a dangling parent into a root', () => {
    const tree: TreeNode<Item>[] = nodes(-1, [item(1, null, 'A'), item(2, 99, 'Orphan')]);
    expect(tree.map((node: TreeNode<Item>) => node.data?.name)).toEqual(['A', 'Orphan']);
  });

  it('throws on a duplicate id and on a cycle', () => {
    expect(() => nodes(-1, [item(1, null, 'A'), item(1, null, 'B')])).toThrow(/duplicate/);
    expect(() => nodes(-1, [item(1, 2, 'A'), item(2, 1, 'B')])).toThrow(/cycle/);
  });
});

describe('sortTreeNodes', () => {
  it('sorts every level in place, never moving a child out of its parent', () => {
    const tree: TreeNode<Item>[] = nodes(-1);
    sortTreeNodes(tree, (a: Item, b: Item) => b.name.localeCompare(a.name));
    expect(tree.map((node: TreeNode<Item>) => node.data?.name)).toEqual(['Z', 'A']);
    expect(tree[1].children?.map((node: TreeNode<Item>) => node.data?.name)).toEqual(['C', 'B']);
    expect(tree[1].children?.[1].children?.map((node: TreeNode<Item>) => node.data?.name)).toEqual([
      'D',
    ]);
  });

  it('is idempotent', () => {
    const tree: TreeNode<Item>[] = nodes(-1);
    const compare = (a: Item, b: Item): number => b.name.localeCompare(a.name);
    sortTreeNodes(tree, compare);
    sortTreeNodes(tree, compare);
    expect(tree.map((node: TreeNode<Item>) => node.data?.name)).toEqual(['Z', 'A']);
  });

  it('throws on a node without data', () => {
    expect(() => {
      sortTreeNodes<Item>([{ key: 'x' }, { key: 'y' }], () => 0);
    }).toThrow(/without data/);
  });
});

describe('validateTreeMode', () => {
  const columns: readonly DataTableColDef<Item, unknown>[] = [
    colDef<Item, string>({ colId: 'name', headerKey: 'transactions.colRecipient' }),
    colDef<Item, number>({ colId: 'id', hide: true }),
  ];

  function options(
    treeData: Partial<DataTableTreeData<Item>> = {},
    extra: Partial<DataTableTreeOptions<Item>> = {},
  ): DataTableTreeOptions<Item> {
    return {
      getRowId: (row: Item): number => row.id,
      emptyKey: 'transactions.empty',
      treeData: {
        getParentId: (row: Item): number | null => row.parentId,
        groupColId: 'name',
        ...treeData,
      },
      ...extra,
    };
  }

  function validate(
    opts: DataTableTreeOptions<Item>,
    cols: readonly DataTableColDef<Item, unknown>[] = columns,
    externalFilter: ((row: Item) => boolean) | null = null,
  ): void {
    validateTreeMode({ options: opts, columns: cols, externalFilter });
  }

  it('accepts a valid configuration', () => {
    expect(() => {
      validate(options({ groupDefaultExpanded: 1 }));
    }).not.toThrow();
  });

  it('throws on a missing group column', () => {
    expect(() => {
      validate(options({ groupColId: 'nope' }));
    }).toThrow(/groupColId "nope" is not a column/);
  });

  it('throws on a hidden group column', () => {
    expect(() => {
      validate(options({ groupColId: 'id' }));
    }).toThrow(/hidden column/);
  });

  it('throws on a numeric or date column filter', () => {
    for (const filter of ['numeric', 'date'] as const) {
      const cols: readonly DataTableColDef<Item, unknown>[] = [
        ...columns,
        colDef<Item, string>({ colId: 'x', headerKey: 'table.filterSearch', filter }),
      ];
      expect(() => {
        validate(options(), cols);
      }).toThrow(new RegExp(`${filter} filter`));
    }
  });

  it('ignores a numeric filter on a hidden column', () => {
    const cols: readonly DataTableColDef<Item, unknown>[] = [
      ...columns,
      colDef<Item, string>({ colId: 'x', hide: true, filter: 'numeric' }),
    ];
    expect(() => {
      validate(options(), cols);
    }).not.toThrow();
  });

  it('throws on a pagination object', () => {
    const paginated = {
      ...options(),
      pagination: { pageSize: 10, pageSizes: [10] },
    } as unknown as DataTableTreeOptions<Item>;
    expect(() => {
      validate(paginated);
    }).toThrow(/pagination/);
  });

  it('accepts pagination: false', () => {
    expect(() => {
      validate(options({}, { pagination: false }));
    }).not.toThrow();
  });

  it('throws when an external filter is set', () => {
    expect(() => {
      validate(options(), columns, () => true);
    }).toThrow(/externalFilter/);
  });

  it('throws on an invalid groupDefaultExpanded', () => {
    for (const invalid of [-2, 1.5, Number.NaN]) {
      expect(() => {
        validate(options({ groupDefaultExpanded: invalid }));
      }).toThrow(/groupDefaultExpanded/);
    }
  });
});

describe('computeTreeAggregates', () => {
  interface Priced {
    readonly id: number;
    readonly parentId: number | null;
    readonly price: unknown;
  }
  const column: DataTableColDef<Priced, unknown> = colDef<Priced, unknown>({
    colId: 'price',
    headerKey: 'transactions.colAmount',
    aggFunc: 'sum',
  });
  function tree(rows: readonly Priced[]): TreeNode<Priced>[] {
    return toTreeNodes<Priced, Priced>(rows, {
      getId: (row: Priced): number => row.id,
      getParentId: (row: Priced): number | null => row.parentId,
      getData: (row: Priced): Priced => row,
      groupDefaultExpanded: -1,
    });
  }

  it('sums descendant leaves per group node, skipping null/undefined', () => {
    const rows: Priced[] = [
      { id: 1, parentId: null, price: 999 }, // own value ignored for a group
      { id: 2, parentId: 1, price: 5 },
      { id: 3, parentId: 1, price: null },
      { id: 4, parentId: 3, price: 7 },
      { id: 5, parentId: 3, price: undefined },
      { id: 6, parentId: null, price: 1 },
    ];
    const result = computeTreeAggregates<Priced>(tree(rows), [column]);
    expect(result.get(rows[0])?.get('price')).toBe(12);
    expect(result.get(rows[2])?.get('price')).toBe(7);
    expect(result.has(rows[1])).toBe(false);
    expect(result.has(rows[5])).toBe(false);
  });

  it('a group without numeric leaves sums to 0', () => {
    const rows: Priced[] = [
      { id: 1, parentId: null, price: 1 },
      { id: 2, parentId: 1, price: null },
    ];
    expect(computeTreeAggregates<Priced>(tree(rows), [column]).get(rows[0])?.get('price')).toBe(0);
  });

  it('throws on a non-number leaf value', () => {
    const rows: Priced[] = [
      { id: 1, parentId: null, price: 1 },
      { id: 2, parentId: 1, price: '3' },
    ];
    expect(() => computeTreeAggregates<Priced>(tree(rows), [column])).toThrow(/needs numbers/);
  });

  it('is empty without aggFunc columns', () => {
    const rows: Priced[] = [{ id: 1, parentId: null, price: 1 }];
    const plain: DataTableColDef<Priced, unknown> = colDef<Priced, unknown>({
      colId: 'price',
      headerKey: 'transactions.colAmount',
    });
    expect(computeTreeAggregates<Priced>(tree(rows), [plain]).size).toBe(0);
  });
});

describe('validateNoAggFuncOutsideTreeMode', () => {
  const agg: DataTableColDef<Item, unknown> = colDef<Item, unknown>({
    colId: 'id',
    headerKey: 'transactions.colAmount',
    aggFunc: 'sum',
  });

  it('throws for a flat table with an aggFunc column', () => {
    expect(() =>
      validateNoAggFuncOutsideTreeMode<Item>(
        { getRowId: (row: Item): number => row.id, emptyKey: 'transactions.empty' },
        [agg],
      ),
    ).toThrow(/aggFunc/);
  });

  it('passes in tree mode', () => {
    const options: DataTableTreeOptions<Item> = {
      getRowId: (row: Item): number => row.id,
      emptyKey: 'transactions.empty',
      treeData: { getParentId: (row: Item): number | null => row.parentId, groupColId: 'name' },
    };
    expect(() => {
      validateNoAggFuncOutsideTreeMode<Item>(options, [agg]);
    }).not.toThrow();
  });
});
