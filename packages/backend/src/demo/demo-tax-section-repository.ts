import type { TaxSection, TaxSectionCode } from '@hibiscus-frontend/shared/contracts/tax-tags';
import { DuplicateKeyError, StillReferencedError } from '../repositories/repository-errors';
import { TAX_SECTION_COLUMNS } from '../repositories/tax-section';
import type { TaxSectionRepository, TaxSectionUpdateResult } from '../repositories/tax-section';
import { TAX_NOT_RELEVANT_CODE } from '../tax/tax-section-defaults';
import { compareText, sameValue } from './demo-store';
import type { DemoStore } from './demo-store';

/** Only the `TaxSection` columns, so extra request properties never reach the store. */
function toSection(section: TaxSection): TaxSection {
  return {
    code: section.code,
    name: section.name,
    form: section.form,
    belongs: section.belongs,
    excludes: section.excludes,
    receipts: section.receipts,
    note: section.note,
  };
}

/** `hf_tax_section` of the demo data; the built-in `St-0` row is never listed or deleted. */
export class DemoTaxSectionRepository implements TaxSectionRepository {
  constructor(private readonly store: DemoStore) {}

  async list(): Promise<TaxSection[]> {
    return [...this.store.taxSections.values()]
      .filter((section: TaxSection) => section.code !== TAX_NOT_RELEVANT_CODE)
      .sort((a: TaxSection, b: TaxSection): number => compareText(a.code, b.code))
      .map(toSection);
  }

  async create(section: TaxSection): Promise<TaxSection> {
    if (this.store.taxSections.has(section.code)) {
      throw new DuplicateKeyError(`Tax section ${section.code}`);
    }
    const stored: TaxSection = toSection(section);
    this.store.taxSections.set(stored.code, stored);
    return toSection(stored);
  }

  /** Like the MySQL `UPDATE … WHERE` every column `<=>` `expected`; no row matched is `conflict`. */
  async update(expected: TaxSection, next: TaxSection): Promise<TaxSectionUpdateResult> {
    const current: TaxSection | undefined = this.store.taxSections.get(expected.code);
    const matches: boolean =
      current !== undefined &&
      TAX_SECTION_COLUMNS.every((column: keyof TaxSection) =>
        sameValue(current[column], expected[column]),
      );
    if (!matches) return 'conflict';
    const codeChanged: boolean = next.code !== expected.code;
    if (codeChanged && this.store.taxSections.has(next.code)) {
      throw new DuplicateKeyError(`Tax section ${next.code}`);
    }
    if (codeChanged) {
      this.store.taxSections.delete(expected.code);
      // `fk_hf_tax_tag_section … ON UPDATE CASCADE`: the tags follow the new code.
      for (const [categoryId, code] of this.store.taxTags) {
        if (code === expected.code) this.store.taxTags.set(categoryId, next.code);
      }
    }
    this.store.taxSections.set(next.code, toSection(next));
    return 'updated';
  }

  async delete(code: TaxSectionCode): Promise<boolean> {
    if (code === TAX_NOT_RELEVANT_CODE || !this.store.taxSections.has(code)) return false;
    for (const tagCode of this.store.taxTags.values()) {
      // `fk_hf_tax_tag_section … ON DELETE RESTRICT`.
      if (tagCode === code) throw new StillReferencedError(`Tax section ${code}`);
    }
    this.store.taxSections.delete(code);
    return true;
  }
}
