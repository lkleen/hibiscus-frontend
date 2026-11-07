import { describe, expect, it } from 'vitest';
import { DEFAULT_TAX_SECTIONS, TAX_NOT_RELEVANT_CODE } from '../tax/tax-section-defaults';
import type { DemoDataset } from './demo-dataset';
import {
  compareText,
  createDemoStore,
  formatTimestamp,
  nextId,
  parseTimestamp,
  sameValue,
} from './demo-store';
import type { DemoStore } from './demo-store';
import { createTestDataset } from './demo-test-dataset.fixture';

describe('createDemoStore', () => {
  it('fills the tables from the dataset, transactions in id order', () => {
    const store: DemoStore = createDemoStore(createTestDataset());
    expect([...store.transactions.keys()]).toEqual([1, 2, 3]);
    expect(store.categories.size).toBe(3);
    expect(store.taxTags.get(2)).toBe('St-WK');
  });

  it('seeds the default tax sections and St-0', () => {
    const store: DemoStore = createDemoStore(createTestDataset());
    expect(store.taxSections.has(TAX_NOT_RELEVANT_CODE)).toBe(true);
    expect(store.taxSections.size).toBe(DEFAULT_TAX_SECTIONS.length + 1);
  });

  it('deep-copies the dataset', () => {
    const dataset: DemoDataset = createTestDataset();
    const store: DemoStore = createDemoStore(dataset);
    expect(store.categories.get(1)).not.toBe(dataset.categories[0]);
    expect(store.accounts[0]).not.toBe(dataset.accounts[0]);
  });

  it('throws on a broken foreign key', () => {
    const dataset: DemoDataset = createTestDataset();
    dataset.taxTags.push({ category_id: 3, code: 'St-XX' });
    expect(() => createDemoStore(dataset)).toThrow(/unknown code/);
    const orphan: DemoDataset = createTestDataset();
    orphan.categories[0] = { ...orphan.categories[0], parent_id: 99 };
    expect(() => createDemoStore(orphan)).toThrow(/unknown parent/);
  });

  it('throws on a duplicate id', () => {
    const dataset: DemoDataset = createTestDataset();
    dataset.transactions.push({ ...dataset.transactions[0] });
    expect(() => createDemoStore(dataset)).toThrow(/not unique/);
  });
});

describe('helpers', () => {
  it('nextId is the highest id + 1', () => {
    expect(nextId([])).toBe(1);
    expect(nextId([3, 7, 2])).toBe(8);
  });

  it('sameValue is NULL-safe', () => {
    expect(sameValue(null, null)).toBe(true);
    expect(sameValue(null, 0)).toBe(false);
    expect(sameValue('a', 'a')).toBe(true);
  });

  it('compareText sorts NULL first and ignores case', () => {
    expect(compareText(null, 'a')).toBeLessThan(0);
    expect(compareText('a', 'B')).toBeLessThan(0);
    expect(compareText('abc', 'ABC')).toBe(0);
  });

  it('formats and parses timestamps in local time', () => {
    const date: Date = new Date(2026, 10, 7, 9, 5, 3);
    expect(formatTimestamp(date)).toBe('2026-11-07 09:05:03');
    expect(parseTimestamp('2026-11-07 09:05:03').getTime()).toBe(date.getTime());
    expect(() => parseTimestamp('2026-11-07')).toThrow();
  });
});
