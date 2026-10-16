import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import { categoryPaths } from './category-path';
import { categoryRow } from './testing/category-row-fixture';

describe('categoryPaths', () => {
  it('joins the names from the root down to each category', () => {
    const categories: CategoryRow[] = [
      categoryRow({ id: 3, name: 'Supermarket', parent_id: 2 }),
      categoryRow({ id: 1, name: 'Living', parent_id: null }),
      categoryRow({ id: 2, name: 'Food', parent_id: 1 }),
    ];

    const paths: ReadonlyMap<number, string> = categoryPaths(categories);

    expect(paths.get(1)).toBe('Living');
    expect(paths.get(2)).toBe('Living / Food');
    expect(paths.get(3)).toBe('Living / Food / Supermarket');
  });

  it('treats a category with a dangling parent id as a root', () => {
    const paths: ReadonlyMap<number, string> = categoryPaths([
      categoryRow({ id: 1, name: 'Orphan', parent_id: 99 }),
    ]);

    expect(paths.get(1)).toBe('Orphan');
  });

  it('throws on a cycle', () => {
    expect(() =>
      categoryPaths([
        categoryRow({ id: 1, name: 'A', parent_id: 2 }),
        categoryRow({ id: 2, name: 'B', parent_id: 1 }),
      ]),
    ).toThrow('is its own ancestor');
  });
});
