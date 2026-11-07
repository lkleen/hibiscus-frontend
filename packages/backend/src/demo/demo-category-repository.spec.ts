import { beforeEach, describe, expect, it } from 'vitest';
import type {
  CategoryEditableFields,
  CategoryRow,
} from '@hibiscus-frontend/shared/contracts/categories';
import { MissingReferenceError } from '../repositories/repository-errors';
import type { CategoryUpdateResult } from '../repositories/umsatztyp';
import { DemoCategoryRepository } from './demo-category-repository';
import { createDemoStore } from './demo-store';
import type { DemoStore } from './demo-store';
import { createTestDataset } from './demo-test-dataset.fixture';

/** The editable fields of a stored category. */
function fieldsOf(store: DemoStore, id: number): CategoryEditableFields {
  const row: CategoryRow | undefined = store.categories.get(id);
  if (row === undefined) throw new Error(`No category ${id}`);
  const { id: storedId, ...fields } = row;
  if (storedId !== id) throw new Error(`Category ${id} is stored as ${storedId}`);
  return fields;
}

describe('DemoCategoryRepository', () => {
  let store: DemoStore;
  let repository: DemoCategoryRepository;

  beforeEach(() => {
    store = createDemoStore(createTestDataset());
    repository = new DemoCategoryRepository(store);
  });

  it('lists the rows ordered by name', async () => {
    const rows: CategoryRow[] = await repository.list();
    expect(rows.map((row: CategoryRow) => row.name)).toEqual(['Miete', 'Nebenkosten', 'Wohnen']);
  });

  it('creates a row with the next id and its tax tag', async () => {
    const created: CategoryRow = await repository.create({
      ...fieldsOf(store, 1),
      name: 'Neu',
      parent_id: 1,
      taxTag: 'St-HH',
    });
    expect(created.id).toBe(4);
    expect(store.categories.get(4)).toEqual(created);
    expect(store.taxTags.get(4)).toBe('St-HH');
  });

  it('creates nothing for an unknown parent, account or tax section', async () => {
    const base: CategoryEditableFields = fieldsOf(store, 1);
    await expect(repository.create({ ...base, parent_id: 9, taxTag: null })).rejects.toEqual(
      new MissingReferenceError('parent'),
    );
    await expect(repository.create({ ...base, konto_id: 9, taxTag: null })).rejects.toEqual(
      new MissingReferenceError('account'),
    );
    await expect(repository.create({ ...base, taxTag: 'St-XX' })).rejects.toEqual(
      new MissingReferenceError('tax-section'),
    );
    expect(store.categories.size).toBe(3);
  });

  it('updates the row and its tag together', async () => {
    const expected: CategoryEditableFields = fieldsOf(store, 2);
    const result: CategoryUpdateResult = await repository.update(2, {
      expected,
      next: { ...expected, name: 'Kaltmiete' },
      taxTag: { expected: 'St-WK', next: null },
    });
    expect(result).toBe('updated');
    expect(store.categories.get(2)?.name).toBe('Kaltmiete');
    expect(store.taxTags.has(2)).toBe(false);
  });

  it('counts a no-op update as updated', async () => {
    const expected: CategoryEditableFields = fieldsOf(store, 2);
    const result: CategoryUpdateResult = await repository.update(2, {
      expected,
      next: expected,
      taxTag: { expected: 'St-WK', next: 'St-WK' },
    });
    expect(result).toBe('updated');
  });

  it('answers cycle for a parent among the descendants', async () => {
    const expected: CategoryEditableFields = fieldsOf(store, 1);
    const result: CategoryUpdateResult = await repository.update(1, {
      expected,
      next: { ...expected, parent_id: 3 },
      taxTag: { expected: null, next: null },
    });
    expect(result).toBe('cycle');
    expect(store.categories.get(1)?.parent_id).toBeNull();
  });

  it('answers conflict for a stale row or a stale tag and writes nothing', async () => {
    const expected: CategoryEditableFields = fieldsOf(store, 2);
    const staleRow: CategoryUpdateResult = await repository.update(2, {
      expected: { ...expected, name: 'Anders' },
      next: { ...expected, name: 'Neu' },
      taxTag: { expected: 'St-WK', next: 'St-WK' },
    });
    const staleTag: CategoryUpdateResult = await repository.update(2, {
      expected,
      next: { ...expected, name: 'Neu' },
      taxTag: { expected: null, next: 'St-HH' },
    });
    expect([staleRow, staleTag]).toEqual(['conflict', 'conflict']);
    expect(store.categories.get(2)?.name).toBe('Miete');
    expect(store.taxTags.get(2)).toBe('St-WK');
  });

  it('answers not-found for a missing row', async () => {
    const expected: CategoryEditableFields = fieldsOf(store, 2);
    const result: CategoryUpdateResult = await repository.update(9, {
      expected,
      next: expected,
      taxTag: { expected: null, next: null },
    });
    expect(result).toBe('not-found');
  });

  it('throws for an unknown tag code and leaves the row unchanged', async () => {
    const expected: CategoryEditableFields = fieldsOf(store, 3);
    await expect(
      repository.update(3, {
        expected,
        next: { ...expected, name: 'Neu' },
        taxTag: { expected: null, next: 'St-XX' },
      }),
    ).rejects.toEqual(new MissingReferenceError('tax-section'));
    expect(store.categories.get(3)?.name).toBe('Nebenkosten');
  });
});
