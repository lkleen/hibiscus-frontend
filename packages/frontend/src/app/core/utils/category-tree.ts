import { Category, CategoryTreeNode } from '../models/category.model';

/**
 * Builds the parent/child category tree from the flat list the API returns
 * (`GET /api/categories`). Root categories are those with `parentId === null`; any category
 * whose declared parent isn't present in the input is treated as a root too, so a category never
 * silently disappears from the tree because of a dangling reference.
 */
export function buildCategoryTree(categories: readonly Category[]): CategoryTreeNode[] {
  const nodesById = new Map<number, CategoryTreeNode>();
  for (const category of categories) {
    nodesById.set(category.id, { ...category, children: [] });
  }

  const roots: CategoryTreeNode[] = [];
  for (const category of categories) {
    const node = nodesById.get(category.id);
    if (!node) {
      throw new Error(`buildCategoryTree: missing node for category ${category.id}`);
    }

    const parent = category.parentId === null ? undefined : nodesById.get(category.parentId);
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}
