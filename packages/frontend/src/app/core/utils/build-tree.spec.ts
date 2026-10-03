import { buildTree, TreeBranch } from './build-tree';

interface TestRow {
  readonly id: number;
  readonly parentId: number | null;
  readonly name: string;
}

interface TestRowString {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
}

function row(overrides: Partial<TestRow> & { id: number }): TestRow {
  return {
    name: `Row ${overrides.id}`,
    parentId: null,
    ...overrides,
  };
}

function rowString(overrides: Partial<TestRowString> & { id: string }): TestRowString {
  return {
    name: `Row ${overrides.id}`,
    parentId: null,
    ...overrides,
  };
}

describe('buildTree', () => {
  it('returns an empty tree for an empty list', () => {
    const result: TreeBranch<TestRow>[] = buildTree([], {
      getId: (r: TestRow) => r.id,
      getParentId: (r: TestRow) => r.parentId,
    });
    expect(result).toEqual([]);
  });

  it('nests children under their parent', () => {
    const rows: TestRow[] = [
      row({ id: 1, name: 'Living' }),
      row({ id: 2, name: 'Rent', parentId: 1 }),
      row({ id: 3, name: 'Utilities', parentId: 1 }),
      row({ id: 4, name: 'Electricity', parentId: 3 }),
    ];

    const tree: TreeBranch<TestRow>[] = buildTree(rows, {
      getId: (r: TestRow) => r.id,
      getParentId: (r: TestRow) => r.parentId,
    });

    expect(tree).toHaveLength(1);
    expect(tree[0].row.id).toBe(1);
    expect(tree[0].children.map((c) => c.row.id)).toEqual([2, 3]);

    const utilities: TreeBranch<TestRow> | undefined = tree[0].children.find((c) => c.row.id === 3);
    expect(utilities?.children.map((c) => c.row.id)).toEqual([4]);
  });

  it('keeps multiple roots as siblings at the top level', () => {
    const rows: TestRow[] = [row({ id: 1 }), row({ id: 2 })];

    const tree: TreeBranch<TestRow>[] = buildTree(rows, {
      getId: (r: TestRow) => r.id,
      getParentId: (r: TestRow) => r.parentId,
    });

    expect(tree.map((c) => c.row.id)).toEqual([1, 2]);
  });

  it('treats a row with a dangling parentId as a root instead of dropping it', () => {
    const rows: TestRow[] = [row({ id: 1, parentId: 999 })];

    const tree: TreeBranch<TestRow>[] = buildTree(rows, {
      getId: (r: TestRow) => r.id,
      getParentId: (r: TestRow) => r.parentId,
    });

    expect(tree.map((c) => c.row.id)).toEqual([1]);
  });

  it('preserves row fields on tree nodes', () => {
    const rows: TestRow[] = [row({ id: 1, name: 'Groceries' })];

    const tree: TreeBranch<TestRow>[] = buildTree(rows, {
      getId: (r: TestRow) => r.id,
      getParentId: (r: TestRow) => r.parentId,
    });

    expect(tree[0]).toMatchObject({ row: { id: 1, name: 'Groceries' }, children: [] });
  });

  it('preserves input order of siblings', () => {
    const rows: TestRow[] = [
      row({ id: 5, name: 'Fifth' }),
      row({ id: 2, name: 'Second' }),
      row({ id: 8, name: 'Eighth' }),
    ];

    const tree: TreeBranch<TestRow>[] = buildTree(rows, {
      getId: (r: TestRow) => r.id,
      getParentId: (r: TestRow) => r.parentId,
    });

    expect(tree.map((c) => c.row.id)).toEqual([5, 2, 8]);
  });

  it('works with string ids', () => {
    const rows: TestRowString[] = [
      rowString({ id: 'a', name: 'Alpha' }),
      rowString({ id: 'b', name: 'Beta', parentId: 'a' }),
      rowString({ id: 'c', name: 'Gamma', parentId: 'a' }),
    ];

    const tree: TreeBranch<TestRowString>[] = buildTree(rows, {
      getId: (r: TestRowString) => r.id,
      getParentId: (r: TestRowString) => r.parentId,
    });

    expect(tree).toHaveLength(1);
    expect(tree[0].row.id).toBe('a');
    expect(tree[0].children.map((c) => c.row.id)).toEqual(['b', 'c']);
  });

  it('throws on duplicate id', () => {
    const rows: TestRow[] = [row({ id: 1, name: 'First' }), row({ id: 1, name: 'Duplicate' })];

    expect(() => {
      buildTree(rows, {
        getId: (r: TestRow) => r.id,
        getParentId: (r: TestRow) => r.parentId,
      });
    }).toThrowError('buildTree: duplicate id 1');
  });

  it('throws on two-cycle (A→B→A)', () => {
    const rows: TestRow[] = [row({ id: 1, parentId: 2 }), row({ id: 2, parentId: 1 })];

    expect(() => {
      buildTree(rows, {
        getId: (r: TestRow) => r.id,
        getParentId: (r: TestRow) => r.parentId,
      });
    }).toThrowError(/buildTree: cycle detected; unreachable ids:/);
  });

  it('throws on self-parent cycle', () => {
    const rows: TestRow[] = [row({ id: 1, parentId: 1 })];

    expect(() => {
      buildTree(rows, {
        getId: (r: TestRow) => r.id,
        getParentId: (r: TestRow) => r.parentId,
      });
    }).toThrowError(/buildTree: cycle detected; unreachable ids:/);
  });
});
