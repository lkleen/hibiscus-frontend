import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import type { TaxTagCode } from '@hibiscus-frontend/shared/contracts/tax-tags';
import type { TaxSituation } from '@hibiscus-frontend/shared/contracts/user-settings';
import { categoryRow } from '../utils/testing/category-row-fixture';
import {
  TAX_SECTIONS,
  effectiveTaxSection,
  enabledSections,
  taxSectionByCode,
  suggestTaxSections,
  type EffectiveTaxSection,
  type TaxSection,
} from './tax-sections';

function byId(categories: CategoryRow[]): Map<number, CategoryRow> {
  return new Map(categories.map((c: CategoryRow): [number, CategoryRow] => [c.id, c]));
}

function answers(overrides: Partial<Record<TaxSituation, boolean | null>> = {}) {
  return {
    employed: null,
    children: null,
    household: null,
    rental: null,
    donations: null,
    ...overrides,
  };
}

function section(code: string): TaxSection {
  const found: TaxSection | undefined = TAX_SECTIONS.find((s: TaxSection) => s.code === code);
  if (!found) throw new Error(`no section ${code}`);
  return found;
}

function tagMap(entries: [number, TaxTagCode][]): Map<number, TaxTagCode> {
  return new Map<number, TaxTagCode>(entries);
}

describe('tax codes', () => {
  it('derives the i18n keys from the code', () => {
    expect(section('St-WK').nameKey).toBe('tax.sections.wk.name');
    expect(section('St-V').formKey).toBe('tax.sections.v.form');
  });
});

describe('taxSectionByCode', () => {
  it('finds a section and throws for an unknown code', () => {
    expect(taxSectionByCode('St-VA')).toBe(section('St-VA'));
    expect(() => taxSectionByCode('St-XX' as TaxSection['code'])).toThrow();
  });
});

describe('effectiveTaxSection', () => {
  it('uses the own tag first', () => {
    const own: CategoryRow = categoryRow({ id: 2, parent_id: 1 });
    const parent: CategoryRow = categoryRow({ id: 1 });
    const result: EffectiveTaxSection = effectiveTaxSection({
      category: own,
      byId: byId([parent, own]),
      tags: tagMap([
        [2, 'St-SA'],
        [1, 'St-WK'],
      ]),
    });
    expect(result).toEqual({ section: section('St-SA'), inherited: false, sourceCategoryId: 2 });
  });

  it('inherits from the nearest tagged ancestor', () => {
    const root: CategoryRow = categoryRow({ id: 1 });
    const mid: CategoryRow = categoryRow({ id: 2, parent_id: 1 });
    const leaf: CategoryRow = categoryRow({ id: 3, parent_id: 2 });
    const result: EffectiveTaxSection = effectiveTaxSection({
      category: leaf,
      byId: byId([root, mid, leaf]),
      tags: tagMap([[1, 'St-WK']]),
    });
    expect(result).toEqual({ section: section('St-WK'), inherited: true, sourceCategoryId: 1 });
  });

  it('stops inheritance at St-0', () => {
    const root: CategoryRow = categoryRow({ id: 1 });
    const off: CategoryRow = categoryRow({ id: 2, parent_id: 1 });
    const leaf: CategoryRow = categoryRow({ id: 3, parent_id: 2 });
    const result: EffectiveTaxSection = effectiveTaxSection({
      category: leaf,
      byId: byId([root, off, leaf]),
      tags: tagMap([
        [1, 'St-WK'],
        [2, 'St-0'],
      ]),
    });
    expect(result).toEqual({ section: null, inherited: true, sourceCategoryId: 2 });
  });

  it('reports nothing when the chain is untagged or the parent is unknown', () => {
    const leaf: CategoryRow = categoryRow({ id: 2, parent_id: 99 });
    expect(effectiveTaxSection({ category: leaf, byId: byId([leaf]), tags: tagMap([]) })).toEqual({
      section: null,
      inherited: false,
      sourceCategoryId: null,
    });
  });

  it('throws on a cycle', () => {
    const a: CategoryRow = categoryRow({ id: 1, parent_id: 2 });
    const b: CategoryRow = categoryRow({ id: 2, parent_id: 1 });
    expect(() =>
      effectiveTaxSection({ category: a, byId: byId([a, b]), tags: tagMap([]) }),
    ).toThrow();
  });
});

describe('enabledSections', () => {
  const codes = (sections: readonly TaxSection[]): string[] => sections.map((s) => s.code);

  it('keeps unanswered sections visible', () => {
    expect(enabledSections(answers())).toHaveLength(TAX_SECTIONS.length);
  });

  it('disables a section answered false but never the always-on ones', () => {
    const result: string[] = codes(
      enabledSections(answers({ employed: false, children: false, rental: true })),
    );
    expect(result).not.toContain('St-WK');
    expect(result).not.toContain('St-KI');
    expect(result).toContain('St-V');
    expect(result).toContain('St-VA');
    expect(result).toContain('St-AB');
  });
});

describe('suggestTaxSections', () => {
  const all: readonly TaxSection[] = TAX_SECTIONS;

  it('suggests by keyword in the own name, case-insensitively, in input order', () => {
    const result = suggestTaxSections({
      categories: [
        categoryRow({ id: 1, name: 'Apotheke' }),
        categoryRow({ id: 2, name: 'Supermarkt' }),
        categoryRow({ id: 3, name: 'KITA Beitrag' }),
      ],
      enabled: all,
      tags: tagMap([]),
    });
    expect(result.map((s) => [s.category.id, s.section.code, s.keyword])).toEqual([
      [1, 'St-AB', 'apotheke'],
      [3, 'St-KI', 'kita'],
    ]);
  });

  it('prefers VA over AB for Pflegeversicherung', () => {
    const result = suggestTaxSections({
      categories: [categoryRow({ id: 1, name: 'Pflegeversicherung' })],
      enabled: all,
      tags: tagMap([]),
    });
    expect(result[0].section.code).toBe('St-VA');
  });

  it('skips tagged, inherited and excluded categories', () => {
    const tagged: CategoryRow = categoryRow({ id: 1, name: 'Arzt' });
    const child: CategoryRow = categoryRow({ id: 2, name: 'Zahnarzt', parent_id: 1 });
    const off: CategoryRow = categoryRow({ id: 3, name: 'Apotheke' });
    const offChild: CategoryRow = categoryRow({ id: 4, name: 'Brille', parent_id: 3 });
    expect(
      suggestTaxSections({
        categories: [tagged, child, off, offChild],
        enabled: all,
        tags: tagMap([
          [1, 'St-SA'],
          [3, 'St-0'],
        ]),
      }),
    ).toEqual([]);
  });

  it('skips disabled sections and falls through to the next enabled one', () => {
    const category: CategoryRow = categoryRow({ id: 1, name: 'Pflegeversicherung' });
    const withoutVa: readonly TaxSection[] = all.filter((s: TaxSection) => s.code !== 'St-VA');
    const result = suggestTaxSections({
      categories: [category],
      enabled: withoutVa,
      tags: tagMap([]),
    });
    expect(result[0].section.code).toBe('St-AB');
    expect(suggestTaxSections({ categories: [category], enabled: [], tags: tagMap([]) })).toEqual(
      [],
    );
  });
});
