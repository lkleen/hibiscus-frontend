import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';

/** Joins the category names of a path, root first. */
export const CATEGORY_PATH_SEPARATOR = ' / ';

/**
 * Every category's path from its root to itself, as names joined by `CATEGORY_PATH_SEPARATOR`,
 * keyed by category id. A dangling `parent_id` ends the path there (the category counts as a root,
 * like `buildTree`); a cycle throws.
 */
export function categoryPaths(categories: readonly CategoryRow[]): ReadonlyMap<number, string> {
  const byId: ReadonlyMap<number, CategoryRow> = new Map(
    categories.map((category: CategoryRow): [number, CategoryRow] => [category.id, category]),
  );
  const paths = new Map<number, string>();

  const pathOf = (category: CategoryRow, seen: ReadonlySet<number>): string => {
    const known: string | undefined = paths.get(category.id);
    if (known !== undefined) return known;
    if (seen.has(category.id)) throw new Error(`category ${category.id} is its own ancestor`);
    const parent: CategoryRow | undefined =
      category.parent_id === null ? undefined : byId.get(category.parent_id);
    const path: string =
      parent === undefined
        ? category.name
        : pathOf(parent, new Set(seen).add(category.id)) + CATEGORY_PATH_SEPARATOR + category.name;
    paths.set(category.id, path);
    return path;
  };

  for (const category of categories) pathOf(category, new Set());
  return paths;
}
