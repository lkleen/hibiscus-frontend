import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type {
  CategoryCreateRequest,
  CategoryEditableFields,
  CategoryRow,
  CategoryUpdateRequest,
} from '@hibiscus-frontend/shared/contracts/categories';
import { createsCycle } from '../categories/category-tree';
import { MissingReferenceError } from '../repositories/repository-errors';
import type { TaxTagUpdateParams } from '../repositories/tax-tag';
import { CATEGORY_EDITABLE_COLUMNS } from '../repositories/umsatztyp';
import type { CategoryRepository, CategoryUpdateResult } from '../repositories/umsatztyp';
import { compareText, nextId, sameValue } from './demo-store';
import type { DemoStore } from './demo-store';
import { taxTagUpdateMatches, writeTaxTag } from './demo-tax-tag-repository';

/** The stored row: `id` plus exactly the editable columns of `fields`. */
function toCategoryRow(id: number, fields: CategoryEditableFields): CategoryRow {
  const row: Record<string, unknown> = { id };
  for (const column of CATEGORY_EDITABLE_COLUMNS) row[column] = fields[column];
  // Every `CategoryRow` key is set: `id` above, the rest from `CATEGORY_EDITABLE_COLUMNS`.
  return row as unknown as CategoryRow;
}

/** `umsatztyp` of the demo data, with the tax tags. */
export class DemoCategoryRepository implements CategoryRepository {
  constructor(private readonly store: DemoStore) {}

  async list(): Promise<CategoryRow[]> {
    return [...this.store.categories.values()]
      .map((row: CategoryRow): CategoryRow => ({ ...row }))
      .sort((a: CategoryRow, b: CategoryRow): number => compareText(a.name, b.name) || a.id - b.id);
  }

  /** `fk_umsatztyp_umsatztyp` and `fk_umsatztyp_konto`. */
  private assertReferences(fields: CategoryEditableFields): void {
    if (fields.parent_id !== null && !this.store.categories.has(fields.parent_id)) {
      throw new MissingReferenceError('parent');
    }
    if (
      fields.konto_id !== null &&
      !this.store.accounts.some((account: AccountRow) => account.id === fields.konto_id)
    ) {
      throw new MissingReferenceError('account');
    }
  }

  async create(fields: CategoryCreateRequest): Promise<CategoryRow> {
    this.assertReferences(fields);
    const id: number = nextId(this.store.categories.keys());
    const tag: TaxTagUpdateParams = {
      categoryId: id,
      update: { expected: null, next: fields.taxTag },
    };
    if (!taxTagUpdateMatches(this.store, tag)) {
      throw new Error(`New umsatztyp ${id} already has a tax tag`);
    }
    const row: CategoryRow = toCategoryRow(id, fields);
    this.store.categories.set(id, row);
    writeTaxTag(this.store, tag);
    return { ...row };
  }

  /**
   * In the MySQL order: `not-found`, `cycle`, the row guard (`conflict`), the foreign keys, the tax
   * tag guard (`conflict`); the row and its tag are written together only when all passed.
   */
  async update(id: number, request: CategoryUpdateRequest): Promise<CategoryUpdateResult> {
    const { expected, next } = request;
    const current: CategoryRow | undefined = this.store.categories.get(id);
    if (current === undefined) return 'not-found';
    const parents: Map<number, number | null> = new Map<number, number | null>();
    for (const row of this.store.categories.values()) parents.set(row.id, row.parent_id);
    if (createsCycle(id, next.parent_id, parents)) return 'cycle';
    const holds: boolean = CATEGORY_EDITABLE_COLUMNS.every((column: keyof CategoryEditableFields) =>
      sameValue(current[column], expected[column]),
    );
    if (!holds) return 'conflict';
    this.assertReferences(next);
    const tag: TaxTagUpdateParams = { categoryId: id, update: request.taxTag };
    if (!taxTagUpdateMatches(this.store, tag)) return 'conflict';
    this.store.categories.set(id, toCategoryRow(id, next));
    if (request.taxTag.expected !== request.taxTag.next) writeTaxTag(this.store, tag);
    return 'updated';
  }
}
