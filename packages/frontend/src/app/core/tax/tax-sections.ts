import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import type { TaxSection, TaxTagCode } from '@hibiscus-frontend/shared/contracts/tax-tags';

/** The built-in tag that is never a section (`TaxTagCode` widens it to `string`). */
export type TaxExcludedCode = 'St-0';

/** Marks a category (and everything below it) as not tax-relevant; stops inheritance. */
export const TAX_EXCLUDED_CODE: TaxExcludedCode = 'St-0';

export interface EffectiveTaxSection {
  /** null = not tax-relevant (nothing tagged on the chain, or St-0 reached first). */
  readonly section: TaxSection | null;
  /** true when the section (or the St-0) comes from an ancestor. */
  readonly inherited: boolean;
  /** Category whose tag decided it; null when nothing on the chain is tagged. */
  readonly sourceCategoryId: number | null;
}

/**
 * Own tag, else nearest ancestor with a section or St-0. A parent_id missing from `byId` ends the
 * chain; a cycle or a tag whose code is not in `sections` throws.
 */
export function effectiveTaxSection(params: {
  readonly category: CategoryRow;
  readonly byId: ReadonlyMap<number, CategoryRow>;
  readonly tags: ReadonlyMap<number, TaxTagCode>;
  readonly sections: ReadonlyMap<string, TaxSection>;
}): EffectiveTaxSection {
  const seen: Set<number> = new Set<number>();
  let current: CategoryRow | undefined = params.category;
  while (current !== undefined) {
    if (seen.has(current.id)) throw new Error(`category ${current.id} is its own ancestor`);
    seen.add(current.id);
    const tag: TaxTagCode | undefined = params.tags.get(current.id);
    const inherited: boolean = current.id !== params.category.id;
    if (tag === TAX_EXCLUDED_CODE) {
      return { section: null, inherited, sourceCategoryId: current.id };
    }
    if (tag !== undefined) {
      const section: TaxSection | undefined = params.sections.get(tag);
      if (section === undefined) throw new Error(`unknown tax section "${tag}"`);
      return { section, inherited, sourceCategoryId: current.id };
    }
    current = current.parent_id === null ? undefined : params.byId.get(current.parent_id);
  }
  return { section: null, inherited: false, sourceCategoryId: null };
}
