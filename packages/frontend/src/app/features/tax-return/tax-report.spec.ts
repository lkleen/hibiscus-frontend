import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import type { TaxTagCode } from '@hibiscus-frontend/shared/contracts/tax-tags';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import { categoryRow } from '../../core/utils/testing/category-row-fixture';
import { TAX_SECTIONS, type TaxSection } from '../../core/tax/tax-sections';
import { transaction } from '../transactions/testing/transaction-fixture';
import {
  buildTaxReport,
  compareYears,
  emptyEnabledSections,
  type TaxReport,
  type TaxReportInput,
} from './tax-report';

const WK: TaxSection = TAX_SECTIONS[0];
const VA: TaxSection = TAX_SECTIONS[1];
const SA: TaxSection = TAX_SECTIONS[2];

const CATEGORIES: CategoryRow[] = [
  categoryRow({ id: 1, name: 'Versicherungen' }),
  categoryRow({ id: 2, name: 'Haftpflicht', parent_id: 1 }),
  categoryRow({ id: 3, name: 'Arbeit' }),
  categoryRow({ id: 4, name: 'Privat', parent_id: 1 }),
  categoryRow({ id: 5, name: 'Untagged' }),
];

const TAGS: ReadonlyMap<number, TaxTagCode> = new Map<number, TaxTagCode>([
  [1, 'St-VA'],
  [3, 'St-WK'],
  [4, 'St-0'],
]);

/** Assigns each transaction to the category id given in `assigned` (null = unassigned). */
function build(
  transactions: TransactionRow[],
  assigned: Record<number, number | null>,
  overrides: Partial<TaxReportInput> = {},
): TaxReport {
  const assignment = new Map<number, CategoryRow | null>(
    transactions.map((t: TransactionRow): [number, CategoryRow | null] => {
      const id: number | null = assigned[t.id] ?? null;
      return [t.id, id === null ? null : (CATEGORIES.find((c) => c.id === id) ?? null)];
    }),
  );
  return buildTaxReport({
    transactions,
    assignment,
    categories: CATEGORIES,
    tags: TAGS,
    year: 2026,
    ...overrides,
  });
}

describe('buildTaxReport', () => {
  it('only counts transactions of the chosen year', () => {
    const report: TaxReport = build(
      [
        transaction({ id: 1, datum: '2026-01-01', betrag: -10 }),
        transaction({ id: 2, datum: '2025-12-31', betrag: -20 }),
        transaction({ id: 3, datum: '2027-01-01', betrag: -30 }),
      ],
      { 1: 3, 2: 3, 3: 3 },
    );
    expect(report.sections[0].count).toBe(1);
    expect(report.sections[0].expenses).toBe(10);
  });

  it('inherits the section and drops St-0 and untagged chains', () => {
    const report: TaxReport = build(
      [
        transaction({ id: 1, betrag: -10 }),
        transaction({ id: 2, betrag: -20 }),
        transaction({ id: 3, betrag: -30 }),
      ],
      { 1: 2, 2: 4, 3: 5 },
    );
    expect(report.sections.map((s) => s.section)).toEqual([VA]);
    expect(report.sections[0].categories.map((c) => c.path)).toEqual([
      'Versicherungen / Haftpflicht',
    ]);
    expect(report.sections[0].count).toBe(1);
    expect(report.unassigned.transactions).toEqual([]);
  });

  it('splits income and expenses, both as positive numbers', () => {
    const report: TaxReport = build(
      [
        transaction({ id: 1, betrag: -40 }),
        transaction({ id: 2, betrag: 15 }),
        transaction({ id: 3, betrag: -2 }),
      ],
      { 1: 3, 2: 3, 3: 3 },
    );
    expect(report.sections[0]).toMatchObject({ income: 15, expenses: 42, count: 3 });
    expect(report.sections[0].categories[0]).toMatchObject({ income: 15, expenses: 42, count: 3 });
  });

  it('sums in cents without float drift', () => {
    const report: TaxReport = build(
      [
        transaction({ id: 1, betrag: -0.1 }),
        transaction({ id: 2, betrag: -0.2 }),
        transaction({ id: 3, betrag: -0.7 }),
      ],
      { 1: 3, 2: 3, 3: 3 },
    );
    expect(report.sections[0].expenses).toBe(1);
  });

  it('numbers receipts across sections in section order, then date, then id', () => {
    const report: TaxReport = build(
      [
        transaction({ id: 1, datum: '2026-01-05' }),
        transaction({ id: 2, datum: '2026-03-01' }),
        transaction({ id: 3, datum: '2026-02-01' }),
        transaction({ id: 4, datum: '2026-02-01' }),
      ],
      { 1: 1, 2: 3, 3: 3, 4: 3 },
    );
    expect(report.sections.map((s) => s.section)).toEqual([WK, VA]);
    expect(report.sections.flatMap((s) => s.receipts.map((r) => [r.no, r.transaction.id]))).toEqual(
      [
        [1, 3],
        [2, 4],
        [3, 2],
        [4, 1],
      ],
    );
  });

  it('lists the unassigned transactions of the year with their sum', () => {
    const report: TaxReport = build(
      [
        transaction({ id: 1, betrag: -10.1 }),
        transaction({ id: 2, betrag: 5 }),
        transaction({ id: 3, datum: '2025-05-05', betrag: -99 }),
      ],
      {},
    );
    expect(report.unassigned.transactions.map((t) => t.id)).toEqual([1, 2]);
    expect(report.unassigned.sum).toBe(-5.1);
    expect(report.sections).toEqual([]);
  });

  it('reports tagged categories with both income and expenses as mixed', () => {
    const report: TaxReport = build(
      [
        transaction({ id: 1, betrag: -10 }),
        transaction({ id: 2, betrag: 10 }),
        transaction({ id: 3, betrag: -5 }),
      ],
      { 1: 3, 2: 3, 3: 2 },
    );
    expect(report.mixed.map((m) => m.category.id)).toEqual([3]);
  });

  it('throws on an invalid year', () => {
    for (const year of [1899, 10000, 2026.5, Number.NaN]) {
      expect(() => build([], {}, { year })).toThrow('invalid tax year');
    }
  });

  it('throws when a transaction is missing from the assignment', () => {
    expect(() =>
      buildTaxReport({
        transactions: [transaction({ id: 7 })],
        assignment: new Map<number, CategoryRow | null>(),
        categories: CATEGORIES,
        tags: TAGS,
        year: 2026,
      }),
    ).toThrow('transaction 7 is missing');
  });
});

describe('emptyEnabledSections', () => {
  it('returns the enabled sections without a report', () => {
    const report: TaxReport = build([transaction({ id: 1 })], { 1: 3 });
    expect(emptyEnabledSections({ report, enabled: [WK, VA, SA] })).toEqual([VA, SA]);
  });
});

describe('compareYears', () => {
  function reportWith(year: number, amounts: Record<number, number>): TaxReport {
    const transactions: TransactionRow[] = [
      transaction({ id: 1, betrag: amounts[1] ?? 0, datum: `${year}-02-02` }),
      transaction({ id: 2, betrag: amounts[2] ?? 0, datum: `${year}-02-02` }),
    ];
    return build(transactions, { 1: 3, 2: 1 }, { year });
  }

  it('flags a drop to zero and a change over both thresholds', () => {
    const previous: TaxReport = reportWith(2025, { 1: -500, 2: -300 });
    const current: TaxReport = reportWith(2026, { 1: -1200, 2: 0 });
    const findings = compareYears({ current, previous });
    expect(findings).toEqual([
      { section: WK, side: 'expenses', current: 1200, previous: 500 },
      { section: VA, side: 'expenses', current: 0, previous: 300 },
    ]);
  });

  it('ignores changes that miss either threshold', () => {
    const previous: TaxReport = reportWith(2025, { 1: -1000, 2: -50 });
    const current: TaxReport = reportWith(2026, { 1: -1400, 2: -140 });
    expect(compareYears({ current, previous })).toEqual([]);
  });

  it('flags income appearing from nothing over 100', () => {
    const previous: TaxReport = reportWith(2025, {});
    const current: TaxReport = reportWith(2026, { 1: 250 });
    expect(compareYears({ current, previous })).toEqual([
      { section: WK, side: 'income', current: 250, previous: 0 },
    ]);
  });
});
