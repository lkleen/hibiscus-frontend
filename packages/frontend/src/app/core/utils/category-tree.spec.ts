import { Category } from '../models/category.model';
import { buildCategoryTree } from './category-tree';

function category(overrides: Partial<Category> & { id: number }): Category {
  return {
    name: `Category ${overrides.id}`,
    parentId: null,
    color: null,
    ...overrides,
  };
}

describe('buildCategoryTree', () => {
  it('returns an empty tree for an empty list', () => {
    expect(buildCategoryTree([])).toEqual([]);
  });

  it('nests children under their parent', () => {
    const categories: Category[] = [
      category({ id: 1, name: 'Living' }),
      category({ id: 2, name: 'Rent', parentId: 1 }),
      category({ id: 3, name: 'Utilities', parentId: 1 }),
      category({ id: 4, name: 'Electricity', parentId: 3 }),
    ];

    const tree = buildCategoryTree(categories);

    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe(1);
    expect(tree[0].children.map((c) => c.id)).toEqual([2, 3]);

    const utilities = tree[0].children.find((c) => c.id === 3);
    expect(utilities?.children.map((c) => c.id)).toEqual([4]);
  });

  it('keeps multiple roots as siblings at the top level', () => {
    const categories: Category[] = [category({ id: 1 }), category({ id: 2 })];

    const tree = buildCategoryTree(categories);

    expect(tree.map((c) => c.id)).toEqual([1, 2]);
  });

  it('treats a category with a dangling parentId as a root instead of dropping it', () => {
    const categories: Category[] = [category({ id: 1, parentId: 999 })];

    const tree = buildCategoryTree(categories);

    expect(tree.map((c) => c.id)).toEqual([1]);
  });

  it('preserves color and name fields on tree nodes', () => {
    const categories: Category[] = [category({ id: 1, name: 'Groceries', color: '#2f6f4f' })];

    const tree = buildCategoryTree(categories);

    expect(tree[0]).toMatchObject({ id: 1, name: 'Groceries', color: '#2f6f4f', children: [] });
  });
});
