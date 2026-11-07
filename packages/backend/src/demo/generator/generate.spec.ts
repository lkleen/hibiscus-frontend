import { describe, expect, it } from 'vitest';
import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import type { TaxSection, TaxTag } from '@hibiscus-frontend/shared/contracts/tax-tags';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import type { DemoDataset } from '../demo-dataset';
import { DEFAULT_TAX_SECTIONS } from '../../tax/tax-section-defaults';
import { ACCOUNT_KEYS, ACCOUNTS } from './accounts';
import type { AccountKey } from './accounts';
import { formatDay } from './calendar';
import { categoryId } from './categories';
import type { CategoryKey } from './categories';
import { generateDemoDataset } from './generate';
import { CAR_BOUGHT, EMIL_BORN, JOB_CHANGE } from './timeline';

const END_DATE = '2026-11-07';
const dataset: DemoDataset = generateDemoDataset({ endDate: END_DATE, seed: 20140101 });
const CAR_CATEGORIES: readonly CategoryKey[] = [
  'tanken',
  'werkstatt',
  'kfzVersicherung',
  'autopflege',
  'parken',
];

function rowsOf(kontoId: number): TransactionRow[] {
  return dataset.transactions.filter((row: TransactionRow) => row.konto_id === kontoId);
}

function cents(value: number): number {
  return Math.round(value * 100);
}

function averageSalary(params: { from: string; to: string }): number {
  const salaries: number[] = dataset.transactions
    .filter(
      (row: TransactionRow) =>
        row.purposecode === 'SALA' && row.datum >= params.from && row.datum < params.to,
    )
    .map((row: TransactionRow) => row.betrag);
  if (salaries.length === 0) throw new Error(`No salary between ${params.from} and ${params.to}`);
  return salaries.reduce((sum: number, value: number) => sum + value, 0) / salaries.length;
}

describe('generateDemoDataset', () => {
  it('is deterministic for the same params and differs for another seed', () => {
    const again: DemoDataset = generateDemoDataset({ endDate: END_DATE, seed: 20140101 });
    const other: DemoDataset = generateDemoDataset({ endDate: END_DATE, seed: 7 });

    expect(JSON.stringify(again)).toBe(JSON.stringify(dataset));
    expect(JSON.stringify(other.transactions)).not.toBe(JSON.stringify(dataset.transactions));
  });

  it('covers 2014 up to the end date with roughly 25,000 transactions', () => {
    const dates: string[] = dataset.transactions.map((row: TransactionRow) => row.datum);

    expect(dataset.generatedAt).toBe(END_DATE);
    expect(dataset.transactions.length).toBeGreaterThan(22_000);
    expect(dataset.transactions.length).toBeLessThan(28_000);
    expect(dates[0]?.startsWith('2014-01')).toBe(true);
    expect(dates.every((date: string) => date <= END_DATE)).toBe(true);
    expect(dates[dates.length - 1]?.startsWith('2026-11')).toBe(true);
  });

  it('numbers the rows 1..n in booking-date order', () => {
    dataset.transactions.forEach((row: TransactionRow, index: number) => {
      expect(row.id).toBe(index + 1);
      const previous: TransactionRow | undefined = dataset.transactions[index - 1];
      if (previous) expect(previous.datum <= row.datum).toBe(true);
    });
  });

  it('keeps every running saldo consistent and matches the account balance', () => {
    for (const account of dataset.accounts) {
      const rows: TransactionRow[] = rowsOf(account.id);
      const key: AccountKey | undefined = ACCOUNT_KEYS.find(
        (k: AccountKey) => ACCOUNTS[k].id === account.id,
      );
      if (key === undefined) throw new Error(`Unknown account ${account.id}`);
      let balance: number = ACCOUNTS[key].openingCents;
      for (const row of rows) {
        balance += cents(row.betrag);
        expect(cents(row.saldo ?? NaN)).toBe(balance);
      }
      expect(cents(account.saldo ?? NaN)).toBe(balance);
      expect(account.saldo_datum?.startsWith(END_DATE)).toBe(true);
    }
  });

  it('references existing categories and leaves a few percent uncategorised', () => {
    const ids: Set<number> = new Set<number>(dataset.categories.map((c: CategoryRow) => c.id));
    const uncategorised: number = dataset.transactions.filter(
      (row: TransactionRow) => row.umsatztyp_id === null,
    ).length;

    expect(ids.size).toBe(dataset.categories.length);
    for (const category of dataset.categories) {
      if (category.parent_id !== null) expect(ids.has(category.parent_id)).toBe(true);
    }
    for (const row of dataset.transactions) {
      if (row.umsatztyp_id !== null) expect(ids.has(row.umsatztyp_id)).toBe(true);
    }
    expect(uncategorised / dataset.transactions.length).toBeGreaterThan(0.01);
    expect(uncategorised / dataset.transactions.length).toBeLessThan(0.06);
  });

  it('tags only existing categories with default tax section codes', () => {
    const ids: Set<number> = new Set<number>(dataset.categories.map((c: CategoryRow) => c.id));
    const codes: Set<string> = new Set<string>(
      DEFAULT_TAX_SECTIONS.map((section: TaxSection) => section.code),
    );

    expect(dataset.taxTags.length).toBeGreaterThan(0);
    for (const tag of dataset.taxTags) {
      expect(ids.has(tag.category_id)).toBe(true);
      expect(codes.has(tag.code)).toBe(true);
    }
    expect(new Set(dataset.taxTags.map((tag: TaxTag) => tag.category_id)).size).toBe(
      dataset.taxTags.length,
    );
  });

  it('uses only fake IBANs', () => {
    const ibans: string[] = [
      ...dataset.accounts.map((account: AccountRow) => account.iban ?? ''),
      ...dataset.transactions.flatMap((row: TransactionRow) => row.empfaenger_konto ?? []),
    ];

    expect(ibans.every((iban: string) => iban.startsWith('DE00'))).toBe(true);
  });

  describe('story checkpoints', () => {
    it('has no car costs before the car is bought in 2018', () => {
      const carIds: Set<number> = new Set<number>(CAR_CATEGORIES.map(categoryId));
      const carRows: TransactionRow[] = dataset.transactions.filter(
        (row: TransactionRow) => row.umsatztyp_id !== null && carIds.has(row.umsatztyp_id),
      );

      expect(formatDay(CAR_BOUGHT).startsWith('2018')).toBe(true);
      expect(carRows.length).toBeGreaterThan(100);
      expect(carRows.every((row: TransactionRow) => row.datum >= '2018-01-01')).toBe(true);
      expect(carRows.every((row: TransactionRow) => row.valuta >= formatDay(CAR_BOUGHT))).toBe(
        true,
      );
    });

    it('pays Kindergeld only after Emil is born', () => {
      const kindergeld: TransactionRow[] = dataset.transactions.filter(
        (row: TransactionRow) => row.empfaenger_name === 'Familienkasse Musterland',
      );

      expect(kindergeld.length).toBeGreaterThan(30);
      expect(kindergeld.every((row: TransactionRow) => row.datum > formatDay(EMIL_BORN))).toBe(
        true,
      );
      expect(kindergeld.every((row: TransactionRow) => row.betrag > 0)).toBe(true);
    });

    it('opens the joint account in 2020 and the mortgage in 2021', () => {
      const joint: TransactionRow[] = rowsOf(ACCOUNTS.gemeinschaft.id);
      const mortgage: TransactionRow[] = rowsOf(ACCOUNTS.baufi.id);

      expect(joint.length).toBeGreaterThan(1000);
      expect(joint.every((row: TransactionRow) => row.datum >= '2020-01-01')).toBe(true);
      expect(mortgage.every((row: TransactionRow) => row.datum >= '2021-01-01')).toBe(true);
      expect(mortgage[mortgage.length - 1]?.saldo).toBeLessThan(0);
    });

    it('jumps the salary with the job change in 2022', () => {
      const before: number = averageSalary({ from: '2021-01-01', to: formatDay(JOB_CHANGE) });
      const after: number = averageSalary({ from: formatDay(JOB_CHANGE), to: '2023-01-01' });

      expect(after / before).toBeGreaterThan(1.3);
    });
  });

  it('stops at an earlier end date without later story events', () => {
    const early: DemoDataset = generateDemoDataset({ endDate: '2019-06-30', seed: 1 });

    expect(early.transactions.every((row: TransactionRow) => row.datum <= '2019-06-30')).toBe(true);
    expect(early.transactions.some((row: TransactionRow) => row.konto_id === 4)).toBe(false);
  });

  it('rejects an end date before the story starts', () => {
    expect(() => generateDemoDataset({ endDate: '2013-12-31', seed: 1 })).toThrow();
    expect(() => generateDemoDataset({ endDate: '2026-02-30', seed: 1 })).toThrow();
  });
});
