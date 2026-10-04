import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';

/** Hibiscus `umsatztyp.flags` bit 1 (`FLAG_SKIP_REPORTS`). */
const FLAG_SKIP_REPORTS = 1;

/** Id of the pseudo-node holding the transactions without a category. */
export const UNASSIGNED_ID = 'c-none';

export type CategoryReportRow =
  | {
      readonly kind: 'category';
      readonly id: string;
      readonly parentId: string | null;
      /** `null` for the unassigned pseudo-node. */
      readonly category: CategoryRow | null;
    }
  | {
      readonly kind: 'transaction';
      readonly id: string;
      readonly parentId: string;
      readonly transaction: TransactionRow;
    };

export interface CategoryReportInput {
  readonly transactions: readonly TransactionRow[];
  /** Every transaction id → its category, or null when unassigned (see `assignCategories`). */
  readonly assignment: ReadonlyMap<number, CategoryRow | null>;
  readonly categories: readonly CategoryRow[];
}

function skipsReports(category: CategoryRow): boolean {
  return ((category.flags ?? 0) & FLAG_SKIP_REPORTS) !== 0;
}

/**
 * The flat, self-referencing rows of Hibiscus's "Umsätze nach Kategorien" tree: the categories
 * that hold transactions (plus their ancestors) and the transactions as leaves, plus the always
 * present unassigned node. A category flagged "skip in reports" — or below one — is left out
 * together with its transactions.
 */
export function buildCategoryReport(input: CategoryReportInput): CategoryReportRow[] {
  const byId = new Map<number, CategoryRow>(
    input.categories.map((category: CategoryRow): [number, CategoryRow] => [category.id, category]),
  );
  const skipped = new Map<number, boolean>();

  const isSkipped = (category: CategoryRow, seen: ReadonlySet<number> = new Set()): boolean => {
    const known: boolean | undefined = skipped.get(category.id);
    if (known !== undefined) return known;
    if (seen.has(category.id)) throw new Error(`category ${category.id} is its own ancestor`);
    const parent: CategoryRow | undefined =
      category.parent_id === null ? undefined : byId.get(category.parent_id);
    const result: boolean =
      skipsReports(category) ||
      (parent !== undefined && isSkipped(parent, new Set(seen).add(category.id)));
    skipped.set(category.id, result);
    return result;
  };

  const included = new Map<number, CategoryRow>();
  const include = (category: CategoryRow): void => {
    let current: CategoryRow | undefined = category;
    while (current !== undefined && !included.has(current.id)) {
      included.set(current.id, current);
      current = current.parent_id === null ? undefined : byId.get(current.parent_id);
    }
  };

  const rows: CategoryReportRow[] = [];
  for (const transaction of input.transactions) {
    const assigned: CategoryRow | null | undefined = input.assignment.get(transaction.id);
    if (assigned === undefined) {
      throw new Error(`transaction ${transaction.id} is missing from the category assignment`);
    }
    if (assigned !== null) {
      if (isSkipped(assigned)) continue;
      include(assigned);
    }
    rows.push({
      kind: 'transaction',
      id: `t${transaction.id}`,
      parentId: assigned === null ? UNASSIGNED_ID : `c${assigned.id}`,
      transaction,
    });
  }

  const categoryRows: CategoryReportRow[] = [
    { kind: 'category', id: UNASSIGNED_ID, parentId: null, category: null },
  ];
  for (const category of included.values()) {
    const parentExists: boolean = category.parent_id !== null && byId.has(category.parent_id);
    categoryRows.push({
      kind: 'category',
      id: `c${category.id}`,
      parentId: parentExists ? `c${category.parent_id}` : null,
      category,
    });
  }
  return [...categoryRows, ...rows];
}
