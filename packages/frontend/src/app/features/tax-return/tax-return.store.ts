import {
  DestroyRef,
  Injectable,
  computed,
  inject,
  signal,
  type Signal,
  type WritableSignal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import type { TaxTagChange, TaxTagCode } from '@hibiscus-frontend/shared/contracts/tax-tags';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import type { TaxProfile, TaxSituation } from '@hibiscus-frontend/shared/contracts/user-settings';
import { TaxProfileService } from '../../core/services/tax-profile.service';
import { TaxTagConflictError, TaxTagsService } from '../../core/services/tax-tags.service';
import {
  TAX_EXCLUDED_CODE,
  TAX_SECTIONS,
  effectiveTaxSection,
  enabledSections,
  suggestTaxSections,
  type EffectiveTaxSection,
  type TaxSection,
  type TaxSuggestion,
} from '../../core/tax/tax-sections';
import { TransactionsStore } from '../transactions/transactions.store';
import {
  buildTaxReport,
  compareYears,
  emptyEnabledSections,
  type TaxCategoryTotal,
  type TaxReport,
  type YearOverYearFinding,
} from './tax-report';

/** Oldest year a tax return can be prepared for (mirrors `buildTaxReport`'s lower bound). */
const MIN_TAX_YEAR = 1900;

/** One year the picker offers: it has transactions in the chosen accounts. */
export interface TaxYearOption {
  readonly year: number;
  readonly count: number;
}

/** The chosen year's totals of one category (its own transactions, no descendants). */
export interface TaxYearStats {
  readonly count: number;
  /** Sum of positive amounts. */
  readonly income: number;
  /** Sum of negative amounts, as a positive number. */
  readonly expenses: number;
}

/** What step ③ lists. */
export interface TaxFindings {
  readonly unassigned: TaxReport['unassigned'];
  readonly mixed: readonly TaxCategoryTotal[];
  readonly empty: readonly TaxSection[];
  readonly yearOverYear: readonly YearOverYearFinding[];
}

/** Running sums in cents, so that adding amounts never drifts. */
interface CentsTotal {
  count: number;
  income: number;
  expenses: number;
}

export type TaxSituations = Readonly<Record<TaxSituation, boolean | null>>;

/** Why the last "Save tags" failed; `conflict` names the categories whose tag changed elsewhere. */
export type TaxTagSaveProblem =
  | { readonly kind: 'conflict'; readonly categoryIds: readonly number[] }
  | { readonly kind: 'error' };

/**
 * State of the tax-return feature, on top of the {@link TransactionsStore} the feature shell
 * provides: the chosen year and accounts, the draft tags of step ①, the life situation, and
 * everything derived from them. Every report is a `computed` over the transactions store's
 * signals (`revision`, `categories`), so an assignment or a category edit updates all steps.
 *
 * The report uses the *saved* tags (`TaxTagsService.tags`); the draft only feeds step ①'s tree
 * and suggestions. The store loads the tags if nobody has yet, and `loading` waits for them.
 */
@Injectable()
export class TaxReturnStore {
  readonly transactions: TransactionsStore = inject(TransactionsStore);
  private readonly taxProfile: TaxProfileService = inject(TaxProfileService);
  private readonly tagsService: TaxTagsService = inject(TaxTagsService);

  /** The tax year; set by the wizard from the route before any step renders. */
  readonly year = signal<number | null>(null);

  /** The transactions store's account filter: the picker and the reports share it. */
  readonly excludedAccountIds = this.transactions.excludedAccountIds;

  /** category id → proposed tag (null clears it); nothing is saved until "Save tags". */
  readonly draft = signal<ReadonlyMap<number, TaxTagCode | null>>(new Map());

  /** True while "Save tags" runs; a second save is refused until it finished. */
  private readonly savingState: WritableSignal<boolean> = signal<boolean>(false);
  readonly saving: Signal<boolean> = this.savingState.asReadonly();

  /** The last save's failure; cleared when the next save starts. */
  private readonly saveProblemState: WritableSignal<TaxTagSaveProblem | null> =
    signal<TaxTagSaveProblem | null>(null);
  readonly saveProblem: Signal<TaxTagSaveProblem | null> = this.saveProblemState.asReadonly();

  private readonly tagsLoadError: WritableSignal<boolean> = signal<boolean>(false);

  /** Suggestions the user rejected (session only). */
  readonly rejected = signal<ReadonlySet<number>>(new Set());

  /** Answers given in this session; they win over the stored profile until it catches up. */
  private readonly localSituations = signal<TaxSituations | null>(null);

  readonly loading: Signal<boolean> = computed(
    (): boolean =>
      this.transactions.loading() || !this.taxProfile.loaded() || this.tagsService.tags() === null,
  );
  readonly error: Signal<boolean> = computed(
    (): boolean => this.transactions.error() || this.taxProfile.loadError() || this.tagsLoadError(),
  );
  readonly profileSaveError: Signal<boolean> = this.taxProfile.saveError;

  /** The life-situation answers; `null` until the profile is loaded. */
  readonly situations: Signal<TaxSituations | null> = computed(
    (): TaxSituations | null =>
      this.localSituations() ?? this.taxProfile.profile()?.situations ?? null,
  );

  /** The stored tags; throws until they are loaded (the shell renders nothing before). */
  readonly storedTags: Signal<ReadonlyMap<number, TaxTagCode>> = computed(
    (): ReadonlyMap<number, TaxTagCode> => {
      const tags: ReadonlyMap<number, TaxTagCode> | null = this.tagsService.tags();
      if (tags === null) throw new Error('tax tags are not loaded');
      return tags;
    },
  );

  readonly enabled: Signal<readonly TaxSection[]> = computed((): readonly TaxSection[] => {
    const situations: TaxSituations | null = this.situations();
    return situations === null ? TAX_SECTIONS : enabledSections(situations);
  });

  /** The chosen accounts' transactions, every year. */
  readonly accountTransactions: Signal<readonly TransactionRow[]> = computed(
    (): readonly TransactionRow[] => {
      this.transactions.revision(); // An assignment mutates rows in place.
      const excluded: ReadonlySet<number> = this.excludedAccountIds();
      return this.transactions
        .transactions()
        .filter((row: TransactionRow): boolean => !excluded.has(row.konto_id));
    },
  );

  /** Years with transactions in the chosen accounts, newest first. */
  readonly years: Signal<readonly TaxYearOption[]> = computed((): readonly TaxYearOption[] => {
    const counts: Map<number, number> = new Map<number, number>();
    for (const row of this.accountTransactions()) {
      const year = Number(row.datum.slice(0, 4));
      counts.set(year, (counts.get(year) ?? 0) + 1);
    }
    return [...counts.entries()]
      .filter(([year]: [number, number]): boolean => year >= MIN_TAX_YEAR)
      .sort((a: [number, number], b: [number, number]): number => b[0] - a[0])
      .map(([year, count]: [number, number]): TaxYearOption => ({ year, count }));
  });

  readonly report: Signal<TaxReport> = computed((): TaxReport =>
    this.reportFor(this.requireYear()),
  );

  /** The year before, with the current tags and matching (for the year-over-year check). */
  readonly previousReport: Signal<TaxReport | null> = computed((): TaxReport | null => {
    const year: number = this.requireYear();
    return year - 1 < MIN_TAX_YEAR ? null : this.reportFor(year - 1);
  });

  readonly findings: Signal<TaxFindings> = computed((): TaxFindings => {
    const report: TaxReport = this.report();
    const previous: TaxReport | null = this.previousReport();
    return {
      unassigned: report.unassigned,
      mixed: report.mixed,
      empty: emptyEnabledSections({ report, enabled: this.enabled() }),
      yearOverYear: previous === null ? [] : compareYears({ current: report, previous }),
    };
  });

  /** Open items of step ③: unassigned transactions count as one. */
  readonly openItems: Signal<number> = computed((): number => {
    const findings: TaxFindings = this.findings();
    return (
      (findings.unassigned.transactions.length > 0 ? 1 : 0) +
      findings.mixed.length +
      findings.empty.length +
      findings.yearOverYear.length
    );
  });

  readonly unassignedRows: Signal<readonly TransactionRow[]> = computed(
    (): readonly TransactionRow[] => this.report().unassigned.transactions,
  );

  /** Per category, the chosen year's own transactions (assigned by the saved tags). */
  readonly yearStats: Signal<ReadonlyMap<number, TaxYearStats>> = computed(() => {
    const prefix = String(this.requireYear());
    const assignment: ReadonlyMap<number, CategoryRow | null> =
      this.transactions.categoryAssignment().byTransactionId;
    const cents: Map<number, CentsTotal> = new Map<number, CentsTotal>();
    for (const row of this.accountTransactions()) {
      if (row.datum.slice(0, 4) !== prefix) continue;
      const category: CategoryRow | null | undefined = assignment.get(row.id);
      if (category === undefined) throw new Error(`transaction ${row.id} has no assignment`);
      if (category === null) continue;
      const total: CentsTotal = cents.get(category.id) ?? { count: 0, income: 0, expenses: 0 };
      const amount: number = Math.round(row.betrag * 100);
      if (amount > 0) total.income += amount;
      if (amount < 0) total.expenses -= amount;
      total.count += 1;
      cents.set(category.id, total);
    }
    const stats: Map<number, TaxYearStats> = new Map<number, TaxYearStats>();
    for (const [id, total] of cents) {
      stats.set(id, {
        count: total.count,
        income: total.income / 100,
        expenses: total.expenses / 100,
      });
    }
    return stats;
  });

  /** The stored tags with the draft applied. */
  readonly draftTags: Signal<ReadonlyMap<number, TaxTagCode>> = computed(
    (): ReadonlyMap<number, TaxTagCode> => {
      const tags: Map<number, TaxTagCode> = new Map<number, TaxTagCode>(this.storedTags());
      for (const [id, code] of this.draft()) {
        if (code === null) tags.delete(id);
        else tags.set(id, code);
      }
      return tags;
    },
  );

  private readonly categoriesById: Signal<ReadonlyMap<number, CategoryRow>> = computed(
    (): ReadonlyMap<number, CategoryRow> =>
      new Map<number, CategoryRow>(
        this.transactions.categories().map((c: CategoryRow): [number, CategoryRow] => [c.id, c]),
      ),
  );

  /** The draft entries that differ from what is stored: what "Save tags" saves. */
  readonly pendingDraft: Signal<ReadonlyMap<number, TaxTagCode | null>> = computed(
    (): ReadonlyMap<number, TaxTagCode | null> => {
      const stored: ReadonlyMap<number, TaxTagCode> = this.storedTags();
      const pending: Map<number, TaxTagCode | null> = new Map<number, TaxTagCode | null>();
      for (const [id, code] of this.draft()) {
        if ((stored.get(id) ?? null) !== code) pending.set(id, code);
      }
      return pending;
    },
  );

  readonly suggestions: Signal<readonly TaxSuggestion[]> = computed(
    (): readonly TaxSuggestion[] => {
      const rejected: ReadonlySet<number> = this.rejected();
      return suggestTaxSections({
        categories: this.transactions.categories(),
        enabled: this.enabled(),
        tags: this.draftTags(),
      }).filter((s: TaxSuggestion): boolean => !rejected.has(s.category.id));
    },
  );

  /** True once any stored category carries a section tag (not only `St-0`). */
  readonly hasTags: Signal<boolean> = computed((): boolean =>
    [...this.storedTags().values()].some((code: TaxTagCode): boolean => code !== TAX_EXCLUDED_CODE),
  );

  /** Stored section tags: how many sections and categories use them. */
  readonly tagSummary: Signal<{ readonly sections: number; readonly categories: number }> =
    computed(() => {
      const codes: Set<TaxTagCode> = new Set<TaxTagCode>();
      let categories = 0;
      for (const code of this.storedTags().values()) {
        if (code === TAX_EXCLUDED_CODE) continue;
        codes.add(code);
        categories += 1;
      }
      return { sections: codes.size, categories };
    });

  /** Categories with transactions in the year that nothing on their chain tags (no `St-0` either). */
  readonly reviewCategories: Signal<readonly CategoryRow[]> = computed(
    (): readonly CategoryRow[] => {
      const stats: ReadonlyMap<number, TaxYearStats> = this.yearStats();
      const byId: ReadonlyMap<number, CategoryRow> = this.categoriesById();
      const tags: ReadonlyMap<number, TaxTagCode> = this.draftTags();
      return this.transactions
        .categories()
        .filter(
          (category: CategoryRow): boolean =>
            stats.has(category.id) &&
            effectiveTaxSection({ category, byId, tags }).sourceCategoryId === null,
        );
    },
  );

  /** The effective section of a category with the draft applied. */
  effectiveDraft(categoryId: number): EffectiveTaxSection {
    const byId: ReadonlyMap<number, CategoryRow> = this.categoriesById();
    const category: CategoryRow | undefined = byId.get(categoryId);
    if (category === undefined) throw new Error(`category ${categoryId} is not loaded`);
    return effectiveTaxSection({ category, byId, tags: this.draftTags() });
  }

  /** The category's own tag with the draft applied; null = untagged (inherits). */
  draftTagOf(categoryId: number): TaxTagCode | null {
    return this.draftTags().get(categoryId) ?? null;
  }

  /** Sets the draft tag of a category; a value equal to the stored one drops the entry. */
  setDraft(categoryId: number, code: TaxTagCode | null): void {
    if (!this.categoriesById().has(categoryId)) {
      throw new Error(`category ${categoryId} is not loaded`);
    }
    const next: Map<number, TaxTagCode | null> = new Map<number, TaxTagCode | null>(this.draft());
    if ((this.storedTags().get(categoryId) ?? null) === code) next.delete(categoryId);
    else next.set(categoryId, code);
    this.draft.set(next);
  }

  accept(suggestion: TaxSuggestion): void {
    this.setDraft(suggestion.category.id, suggestion.section.code);
  }

  acceptAll(): void {
    for (const suggestion of this.suggestions()) this.accept(suggestion);
  }

  reject(suggestion: TaxSuggestion): void {
    this.rejected.set(new Set([...this.rejected(), suggestion.category.id]));
  }

  discardDraft(): void {
    this.draft.set(new Map());
  }

  /** Drops draft entries equal to the stored tags (after a save). */
  pruneDraft(): void {
    this.draft.set(new Map<number, TaxTagCode | null>(this.pendingDraft()));
  }

  /**
   * Saves every pending draft entry in one all-or-nothing request, each with the stored tag it
   * started from as `expected`. Throws while a save runs or when nothing is pending. On success
   * the draft is pruned: entries edited during the save that still differ stay. On a conflict
   * the service has reloaded the stored tags: the draft entries of the conflicting categories are
   * dropped so their reloaded value shows (and a deleted category stops conflicting), the rest of
   * the draft is kept, and `saveProblem` names them. Any other error sets `saveProblem` and is
   * rethrown. The save is not tied to the
   * store's lifetime, so leaving the page never cancels a request that may already be applied.
   */
  saveTags(): void {
    if (this.savingState()) throw new Error('tax tags are already being saved');
    const pending: ReadonlyMap<number, TaxTagCode | null> = this.pendingDraft();
    if (pending.size === 0) throw new Error('no tags to save');
    const stored: ReadonlyMap<number, TaxTagCode> = this.storedTags();
    const changes: TaxTagChange[] = [...pending].map(
      ([id, next]: [number, TaxTagCode | null]): TaxTagChange => ({
        category_id: id,
        expected: stored.get(id) ?? null,
        next,
      }),
    );
    this.savingState.set(true);
    this.saveProblemState.set(null);
    this.tagsService.save(changes).subscribe({
      next: (): void => {
        this.savingState.set(false);
        this.pruneDraft();
      },
      error: (cause: unknown): void => {
        this.savingState.set(false);
        if (cause instanceof TaxTagConflictError) {
          this.saveProblemState.set({ kind: 'conflict', categoryIds: cause.conflictIds });
          this.dropDraft(cause.conflictIds);
          return;
        }
        this.saveProblemState.set({ kind: 'error' });
        throw cause;
      },
    });
  }

  /** Answers one life-situation question and saves the whole profile. */
  answer(situation: TaxSituation, value: boolean): void {
    const profile: TaxProfile | null = this.taxProfile.profile();
    const situations: TaxSituations | null = this.situations();
    if (profile === null || situations === null) throw new Error('tax profile is not loaded');
    const next: TaxSituations = { ...situations, [situation]: value };
    // Kept locally: a second answer before the first PUT is confirmed builds on this one, and the
    // serial save queue then stores both.
    this.localSituations.set(next);
    this.taxProfile.save({ ...profile, situations: { ...next } });
  }

  constructor() {
    if (this.tagsService.tags() === null) {
      this.tagsService
        .load()
        .pipe(takeUntilDestroyed(inject(DestroyRef)))
        .subscribe({
          error: (cause: unknown): void => {
            this.tagsLoadError.set(true);
            throw cause;
          },
        });
    }
  }

  /** Removes the draft entries of `categoryIds`; the others stay. */
  private dropDraft(categoryIds: readonly number[]): void {
    const next: Map<number, TaxTagCode | null> = new Map<number, TaxTagCode | null>(this.draft());
    for (const id of categoryIds) next.delete(id);
    this.draft.set(next);
  }

  private requireYear(): number {
    const year: number | null = this.year();
    if (year === null) throw new Error('no tax year chosen');
    return year;
  }

  private reportFor(year: number): TaxReport {
    return buildTaxReport({
      transactions: this.accountTransactions(),
      assignment: this.transactions.categoryAssignment().byTransactionId,
      categories: this.transactions.categories(),
      tags: this.storedTags(),
      year,
    });
  }
}
