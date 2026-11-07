import { describe, expect, it } from 'vitest';
import type { TaxTag } from '@hibiscus-frontend/shared/contracts/tax-tags';
import { MissingReferenceError } from '../repositories/repository-errors';
import type { DemoDataset } from './demo-dataset';
import { createDemoStore } from './demo-store';
import type { DemoStore } from './demo-store';
import { DemoTaxTagRepository, taxTagUpdateMatches } from './demo-tax-tag-repository';
import { createTestDataset } from './demo-test-dataset.fixture';

describe('DemoTaxTagRepository', () => {
  it('lists the tags ordered by category id', async () => {
    const dataset: DemoDataset = createTestDataset();
    dataset.taxTags.unshift({ category_id: 3, code: 'St-0' });
    const tags: TaxTag[] = await new DemoTaxTagRepository(createDemoStore(dataset)).list();
    expect(tags).toEqual([
      { category_id: 2, code: 'St-WK' },
      { category_id: 3, code: 'St-0' },
    ]);
  });
});

describe('taxTagUpdateMatches', () => {
  it('compares the stored tag with expected and checks a changed code', () => {
    const store: DemoStore = createDemoStore(createTestDataset());
    expect(
      taxTagUpdateMatches(store, { categoryId: 2, update: { expected: 'St-WK', next: null } }),
    ).toBe(true);
    expect(
      taxTagUpdateMatches(store, { categoryId: 2, update: { expected: null, next: null } }),
    ).toBe(false);
    expect(() =>
      taxTagUpdateMatches(store, { categoryId: 3, update: { expected: null, next: 'St-XX' } }),
    ).toThrow(MissingReferenceError);
  });
});
