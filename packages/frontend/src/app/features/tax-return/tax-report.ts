import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import type { TaxTagCode } from '@hibiscus-frontend/shared/contracts/tax-tags';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import { categoryPaths } from '../../core/utils/category-path';
import { effectiveTaxSection, TAX_SECTIONS, type TaxSection } from '../../core/tax/tax-sections';
import { compareText } from '../transactions/by-category/category-report';

export interface TaxCategoryTotal {
  readonly category: CategoryRow;
  /** Category path from the root, e.g. 'Versicherungen / Haftpflicht'. */
  readonly path: string;
  /** Sum of positive betrag. */
  readonly income: number;
  /** Sum of negative betrag, as a positive number. */
  readonly expenses: number;
  readonly count: number;
}

export interface TaxReceipt {
  /** Running number across the whole report, starting at 1. */
  readonly no: number;
  readonly transaction: TransactionRow;
  readonly category: CategoryRow;
}

export interface TaxSectionReport {
  readonly section: TaxSection;
  /** Ordered by path (compareText). Only categories with transactions. */
  readonly categories: readonly TaxCategoryTotal[];
  readonly income: number;
  readonly expenses: number;
  readonly count: number;
  /** Ordered by datum ascending, then id. */
  readonly receipts: readonly TaxReceipt[];
}

export interface TaxReport {
  readonly year: number;
  /** Sections with at least one transaction, in TAX_SECTIONS order. */
  readonly sections: readonly TaxSectionReport[];
  /** Year's transactions whose assignment is null. */
  readonly unassigned: { readonly transactions: readonly TransactionRow[]; readonly sum: number };
  /** Tagged categories (in any section) that have both income > 0 and expenses > 0. */
  readonly mixed: readonly TaxCategoryTotal[];
}

export interface TaxReportInput {
  /** Already filtered to the chosen accounts; this function filters by year (datum's first 4 chars). */
  readonly transactions: readonly TransactionRow[];
  /** Every transaction id → its category or null (the result of assignCategories). Missing id throws. */
  readonly assignment: ReadonlyMap<number, CategoryRow | null>;
  readonly categories: readonly CategoryRow[];
  /** Category id → stored tax tag (see `TaxTagsService.tags`). */
  readonly tags: ReadonlyMap<number, TaxTagCode>;
  readonly year: number;
}

/** Running sums in cents, so that adding amounts never drifts. */
interface CentsTotal {
  income: number;
  expenses: number;
  count: number;
}

interface SectionBucket {
  readonly section: TaxSection;
  readonly byCategory: Map<number, CentsTotal & { readonly category: CategoryRow }>;
  readonly entries: { readonly transaction: TransactionRow; readonly category: CategoryRow }[];
}

const MIN_YEAR = 1900;
const MAX_YEAR = 9999;

function toCents(amount: number): number {
  return Math.round(amount * 100);
}

function addCents(total: CentsTotal, betrag: number): void {
  const cents: number = toCents(betrag);
  if (cents > 0) total.income += cents;
  if (cents < 0) total.expenses -= cents;
  total.count += 1;
}

/**
 * Groups one year's transactions by the tax section of their category (own tag or inherited, see
 * `effectiveTaxSection`) and totals them per category and section. Transactions that are not
 * tax-relevant are dropped; those without a category are listed as unassigned. Receipts are
 * numbered over sections in TAX_SECTIONS order, then by booking date and id.
 */
export function buildTaxReport(input: TaxReportInput): TaxReport {
  if (!Number.isInteger(input.year) || input.year < MIN_YEAR || input.year > MAX_YEAR) {
    throw new Error(`invalid tax year ${input.year}`);
  }
  const prefix = String(input.year);
  const byId: ReadonlyMap<number, CategoryRow> = new Map<number, CategoryRow>(
    input.categories.map((c: CategoryRow): [number, CategoryRow] => [c.id, c]),
  );
  const paths: ReadonlyMap<number, string> = categoryPaths(input.categories);
  const buckets: Map<string, SectionBucket> = new Map<string, SectionBucket>();
  const unassignedTransactions: TransactionRow[] = [];
  let unassignedCents = 0;

  for (const transaction of input.transactions) {
    if (transaction.datum.slice(0, 4) !== prefix) continue;
    const assigned: CategoryRow | null | undefined = input.assignment.get(transaction.id);
    if (assigned === undefined) {
      throw new Error(`transaction ${transaction.id} is missing from the category assignment`);
    }
    if (assigned === null) {
      unassignedTransactions.push(transaction);
      unassignedCents += toCents(transaction.betrag);
      continue;
    }
    const section: TaxSection | null = effectiveTaxSection({
      category: assigned,
      byId,
      tags: input.tags,
    }).section;
    if (section === null) continue;
    let bucket: SectionBucket | undefined = buckets.get(section.code);
    if (bucket === undefined) {
      bucket = { section, byCategory: new Map(), entries: [] };
      buckets.set(section.code, bucket);
    }
    let total: (CentsTotal & { readonly category: CategoryRow }) | undefined =
      bucket.byCategory.get(assigned.id);
    if (total === undefined) {
      total = { category: assigned, income: 0, expenses: 0, count: 0 };
      bucket.byCategory.set(assigned.id, total);
    }
    addCents(total, transaction.betrag);
    bucket.entries.push({ transaction, category: assigned });
  }

  const sections: TaxSectionReport[] = [];
  const mixed: TaxCategoryTotal[] = [];
  let no = 0;
  for (const section of TAX_SECTIONS) {
    const bucket: SectionBucket | undefined = buckets.get(section.code);
    if (bucket === undefined) continue;
    const categories: TaxCategoryTotal[] = [...bucket.byCategory.values()]
      .map((total): TaxCategoryTotal => {
        const path: string | undefined = paths.get(total.category.id);
        if (path === undefined) throw new Error(`category ${total.category.id} has no path`);
        return {
          category: total.category,
          path,
          income: total.income / 100,
          expenses: total.expenses / 100,
          count: total.count,
        };
      })
      .sort((a: TaxCategoryTotal, b: TaxCategoryTotal) => compareText(a.path, b.path));
    mixed.push(...categories.filter((c: TaxCategoryTotal) => c.income > 0 && c.expenses > 0));

    const sectionCents: CentsTotal = { income: 0, expenses: 0, count: 0 };
    for (const total of bucket.byCategory.values()) {
      sectionCents.income += total.income;
      sectionCents.expenses += total.expenses;
      sectionCents.count += total.count;
    }
    const receipts: TaxReceipt[] = [...bucket.entries]
      .sort(
        (a, b) =>
          compareText(a.transaction.datum, b.transaction.datum) ||
          a.transaction.id - b.transaction.id,
      )
      .map((entry): TaxReceipt => {
        no += 1;
        return { no, transaction: entry.transaction, category: entry.category };
      });
    sections.push({
      section,
      categories,
      income: sectionCents.income / 100,
      expenses: sectionCents.expenses / 100,
      count: sectionCents.count,
      receipts,
    });
  }

  return {
    year: input.year,
    sections,
    unassigned: { transactions: unassignedTransactions, sum: unassignedCents / 100 },
    mixed,
  };
}

/** Enabled sections (from enabledSections) that have no section report. */
export function emptyEnabledSections(params: {
  readonly report: TaxReport;
  readonly enabled: readonly TaxSection[];
}): TaxSection[] {
  return params.enabled.filter(
    (s: TaxSection) => !params.report.sections.some((r: TaxSectionReport) => r.section === s),
  );
}

export interface YearOverYearFinding {
  readonly section: TaxSection;
  readonly side: 'income' | 'expenses';
  readonly current: number;
  readonly previous: number;
}

/** Minimum absolute change, in cents, for a year-over-year finding. */
const MIN_CHANGE_CENTS = 10_000;

function isConspicuous(current: number, previous: number): boolean {
  const currentCents: number = toCents(current);
  const previousCents: number = toCents(previous);
  if (previousCents > 0 && currentCents === 0) return true;
  const change: number = Math.abs(currentCents - previousCents);
  return change > MIN_CHANGE_CENTS && change * 2 > previousCents;
}

/**
 * Per section and side: previous > 0 and current === 0, or the change exceeds 100 and half of the
 * previous value. Sections of both reports, TAX_SECTIONS order, income before expenses.
 */
export function compareYears(params: {
  readonly current: TaxReport;
  readonly previous: TaxReport;
}): YearOverYearFinding[] {
  const findings: YearOverYearFinding[] = [];
  for (const section of TAX_SECTIONS) {
    const current: TaxSectionReport | undefined = params.current.sections.find(
      (r: TaxSectionReport) => r.section === section,
    );
    const previous: TaxSectionReport | undefined = params.previous.sections.find(
      (r: TaxSectionReport) => r.section === section,
    );
    if (current === undefined && previous === undefined) continue;
    for (const side of ['income', 'expenses'] as const) {
      const currentValue: number = current?.[side] ?? 0;
      const previousValue: number = previous?.[side] ?? 0;
      if (isConspicuous(currentValue, previousValue)) {
        findings.push({ section, side, current: currentValue, previous: previousValue });
      }
    }
  }
  return findings;
}
