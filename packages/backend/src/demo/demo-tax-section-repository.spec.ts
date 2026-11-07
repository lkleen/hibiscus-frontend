import { beforeEach, describe, expect, it } from 'vitest';
import type { TaxSection } from '@hibiscus-frontend/shared/contracts/tax-tags';
import { DuplicateKeyError, StillReferencedError } from '../repositories/repository-errors';
import type { TaxSectionUpdateResult } from '../repositories/tax-section';
import { DEFAULT_TAX_SECTIONS, TAX_NOT_RELEVANT_CODE } from '../tax/tax-section-defaults';
import { createDemoStore } from './demo-store';
import type { DemoStore } from './demo-store';
import { DemoTaxSectionRepository } from './demo-tax-section-repository';
import { createTestDataset } from './demo-test-dataset.fixture';

const SECTION: TaxSection = {
  code: 'St-XY',
  name: 'Eigene',
  form: null,
  belongs: null,
  excludes: null,
  receipts: null,
  note: null,
};

function section(store: DemoStore, code: string): TaxSection {
  const found: TaxSection | undefined = store.taxSections.get(code);
  if (found === undefined) throw new Error(`No section ${code}`);
  return found;
}

describe('DemoTaxSectionRepository', () => {
  let store: DemoStore;
  let repository: DemoTaxSectionRepository;

  beforeEach(() => {
    store = createDemoStore(createTestDataset());
    repository = new DemoTaxSectionRepository(store);
  });

  it('lists the defaults ordered by code, without St-0', async () => {
    const sections: TaxSection[] = await repository.list();
    const codes: string[] = sections.map((s: TaxSection) => s.code);
    expect(codes).not.toContain(TAX_NOT_RELEVANT_CODE);
    expect(codes).toEqual(DEFAULT_TAX_SECTIONS.map((s: TaxSection) => s.code).sort());
  });

  it('creates a section and refuses a taken code', async () => {
    expect(await repository.create(SECTION)).toEqual(SECTION);
    await expect(repository.create(SECTION)).rejects.toBeInstanceOf(DuplicateKeyError);
    await expect(
      repository.create({ ...SECTION, code: TAX_NOT_RELEVANT_CODE }),
    ).rejects.toBeInstanceOf(DuplicateKeyError);
  });

  it('renames a code and carries the tags along', async () => {
    const expected: TaxSection = section(store, 'St-WK');
    const result: TaxSectionUpdateResult = await repository.update(expected, {
      ...expected,
      code: 'St-W2',
    });
    expect(result).toBe('updated');
    expect(store.taxSections.has('St-WK')).toBe(false);
    expect(store.taxTags.get(2)).toBe('St-W2');
  });

  it('counts a no-op update as updated and a stale one as conflict', async () => {
    const expected: TaxSection = section(store, 'St-WK');
    expect(await repository.update(expected, expected)).toBe('updated');
    expect(await repository.update({ ...expected, note: null }, expected)).toBe('conflict');
    expect(await repository.update(SECTION, SECTION)).toBe('conflict');
  });

  it('refuses a rename to a taken code', async () => {
    const expected: TaxSection = section(store, 'St-WK');
    await expect(
      repository.update(expected, { ...expected, code: 'St-HH' }),
    ).rejects.toBeInstanceOf(DuplicateKeyError);
    expect(store.taxSections.get('St-WK')).toEqual(expected);
  });

  it('deletes an unused section, refuses one in use, never deletes St-0', async () => {
    expect(await repository.delete('St-HH')).toBe(true);
    expect(await repository.delete('St-HH')).toBe(false);
    await expect(repository.delete('St-WK')).rejects.toBeInstanceOf(StillReferencedError);
    expect(await repository.delete(TAX_NOT_RELEVANT_CODE)).toBe(false);
    expect(store.taxSections.has(TAX_NOT_RELEVANT_CODE)).toBe(true);
  });
});
