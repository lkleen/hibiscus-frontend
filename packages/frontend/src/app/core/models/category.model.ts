export interface Category {
  id: number;
  name: string;
  parentId: number | null;
  color: string | null;
}

export interface CategoryTreeNode extends Category {
  children: CategoryTreeNode[];
}
