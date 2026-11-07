import type { TaxTag, TaxTagCode } from '@hibiscus-frontend/shared/contracts/tax-tags';
import { MissingReferenceError } from '../repositories/repository-errors';
import type { TaxTagRepository, TaxTagUpdateParams } from '../repositories/tax-tag';
import type { DemoStore } from './demo-store';

/**
 * The check half of MySQL's `applyTaxTagUpdate`: whether the category's stored tag (`null` =
 * untagged) is `update.expected`. When it is and the tag would change, an unknown `next` code
 * throws `MissingReferenceError` (`tax-section`), as the foreign key would on the write. Writes
 * nothing; `writeTaxTag` does, once every check of the caller's change has passed.
 */
export function taxTagUpdateMatches(store: DemoStore, params: TaxTagUpdateParams): boolean {
  const { categoryId, update } = params;
  const stored: TaxTagCode | null = store.taxTags.get(categoryId) ?? null;
  if (stored !== update.expected) return false;
  if (update.expected !== update.next && update.next !== null) {
    if (!store.taxSections.has(update.next)) throw new MissingReferenceError('tax-section');
  }
  return true;
}

/** The write half: sets or removes the tag; call only after `taxTagUpdateMatches` returned true. */
export function writeTaxTag(store: DemoStore, params: TaxTagUpdateParams): void {
  const { categoryId, update } = params;
  if (update.next === null) store.taxTags.delete(categoryId);
  else store.taxTags.set(categoryId, update.next);
}

/** `hf_category_tax_tag` of the demo data; tags are written only through the categories. */
export class DemoTaxTagRepository implements TaxTagRepository {
  constructor(private readonly store: DemoStore) {}

  async list(): Promise<TaxTag[]> {
    return [...this.store.taxTags]
      .sort((a: [number, TaxTagCode], b: [number, TaxTagCode]): number => a[0] - b[0])
      .map(([categoryId, code]: [number, TaxTagCode]): TaxTag => ({
        category_id: categoryId,
        code,
      }));
  }
}
