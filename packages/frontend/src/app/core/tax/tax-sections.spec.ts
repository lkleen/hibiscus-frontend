import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import type { TaxSection, TaxTagCode } from '@hibiscus-frontend/shared/contracts/tax-tags';
import { categoryRow } from '../utils/testing/category-row-fixture';
import { effectiveTaxSection, type EffectiveTaxSection } from './tax-sections';

function section(code: string): TaxSection {
  return {
    code,
    name: code,
    form: null,
    belongs: null,
    excludes: null,
    receipts: null,
    note: null,
  };
}

const SECTIONS: ReadonlyMap<string, TaxSection> = new Map<string, TaxSection>(
  ['St-AB', 'St-SA'].map((c: string): [string, TaxSection] => [c, section(c)]),
);

function byId(categories: CategoryRow[]): Map<number, CategoryRow> {
  return new Map(categories.map((c: CategoryRow): [number, CategoryRow] => [c.id, c]));
}

function tagMap(entries: [number, TaxTagCode][]): Map<number, TaxTagCode> {
  return new Map<number, TaxTagCode>(entries);
}

function run(
  categories: CategoryRow[],
  tags: Map<number, TaxTagCode>,
  index = 0,
): EffectiveTaxSection {
  const category: CategoryRow | undefined = categories[index];
  if (!category) throw new Error('no category');
  return effectiveTaxSection({ category, byId: byId(categories), tags, sections: SECTIONS });
}

describe('effectiveTaxSection', () => {
  it('uses the own tag', () => {
    const result: EffectiveTaxSection = run([categoryRow({ id: 1 })], tagMap([[1, 'St-AB']]));
    expect(result).toEqual({
      section: SECTIONS.get('St-AB'),
      inherited: false,
      sourceCategoryId: 1,
    });
  });

  it('inherits from the nearest tagged ancestor', () => {
    const cats: CategoryRow[] = [
      categoryRow({ id: 2, parent_id: 1 }),
      categoryRow({ id: 1, parent_id: null }),
    ];
    const result: EffectiveTaxSection = run(cats, tagMap([[1, 'St-SA']]));
    expect(result.section?.code).toBe('St-SA');
    expect(result.inherited).toBe(true);
    expect(result.sourceCategoryId).toBe(1);
  });

  it('St-0 stops inheritance', () => {
    const cats: CategoryRow[] = [
      categoryRow({ id: 2, parent_id: 1 }),
      categoryRow({ id: 1, parent_id: null }),
    ];
    const result: EffectiveTaxSection = run(
      cats,
      tagMap([
        [1, 'St-AB'],
        [2, 'St-0'],
      ]),
    );
    expect(result).toEqual({ section: null, inherited: false, sourceCategoryId: 2 });
  });

  it('is not relevant when nothing is tagged', () => {
    expect(run([categoryRow({ id: 1 })], tagMap([]))).toEqual({
      section: null,
      inherited: false,
      sourceCategoryId: null,
    });
  });

  it('ends the chain at a parent missing from byId', () => {
    const result: EffectiveTaxSection = run([categoryRow({ id: 2, parent_id: 9 })], tagMap([]));
    expect(result.sourceCategoryId).toBeNull();
  });

  it('throws on a cycle', () => {
    const cats: CategoryRow[] = [
      categoryRow({ id: 1, parent_id: 2 }),
      categoryRow({ id: 2, parent_id: 1 }),
    ];
    expect(() => run(cats, tagMap([]))).toThrow();
  });

  it('throws for a tag whose section is missing', () => {
    expect(() => run([categoryRow({ id: 1 })], tagMap([[1, 'St-GONE']]))).toThrow();
  });
});
