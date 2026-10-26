import { HttpTestingController, type TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import type { TaxTagsUpdateRequest } from '@hibiscus-frontend/shared/contracts/tax-tags';
import type { TaxProfile } from '@hibiscus-frontend/shared/contracts/user-settings';
import { config } from 'rxjs';
import { categoryRow } from '../../core/utils/testing/category-row-fixture';
import { account, transaction } from '../transactions/testing/transaction-fixture';
import { TaxReturnStore } from './tax-return.store';
import { flushTaxLoad, taxProfile, taxReturnProviders } from './testing/tax-return-testing';

const CATEGORIES: CategoryRow[] = [
  categoryRow({ id: 1, name: 'Versicherungen', pattern: 'huk' }),
  categoryRow({ id: 2, name: 'Haftpflicht', parent_id: 1, pattern: 'haftpflicht' }),
  categoryRow({ id: 3, name: 'Apotheke', pattern: 'apo' }),
  categoryRow({ id: 4, name: 'Lebensmittel', pattern: 'rewe' }),
];

describe('TaxReturnStore', () => {
  let store: TaxReturnStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: taxReturnProviders() });
    store = TestBed.inject(TaxReturnStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function load(profile: TaxProfile = taxProfile()): void {
    flushTaxLoad(http, {
      accounts: [account({ id: 1 }), account({ id: 2, bezeichnung: 'Business' })],
      categories: CATEGORIES,
      tags: [{ category_id: 1, code: 'St-VA' }],
      profile,
      transactions: [
        transaction({ id: 1, zweck: 'HUK Beitrag', betrag: -100, datum: '2025-01-05' }),
        transaction({ id: 2, zweck: 'Haftpflicht', betrag: -50, datum: '2025-02-05' }),
        transaction({ id: 3, zweck: 'Apo', betrag: -20, datum: '2025-03-05' }),
        transaction({ id: 4, zweck: 'Rewe', betrag: -30, datum: '2025-03-06' }),
        transaction({ id: 5, zweck: 'Unknown', betrag: -999, datum: '2025-04-01' }),
        transaction({ id: 6, zweck: 'HUK Beitrag', betrag: -400, datum: '2024-01-05' }),
        transaction({ id: 7, konto_id: 2, zweck: 'Other', betrag: -5, datum: '2025-05-01' }),
      ],
    });
    store.year.set(2025);
  }

  it('waits for the transactions, the tax tags and the tax profile', () => {
    expect(store.loading()).toBe(true);
    load();
    expect(store.loading()).toBe(false);
  });

  it('lists the years with transactions in the chosen accounts, newest first', () => {
    load();
    expect(store.years()).toEqual([
      { year: 2025, count: 6 },
      { year: 2024, count: 1 },
    ]);
    store.excludedAccountIds.set(new Set([2]));
    expect(store.years()[0]).toEqual({ year: 2025, count: 5 });
  });

  it('builds the report of the year with inherited sections and the unassigned rows', () => {
    load();
    const report = store.report();
    expect(report.sections.map((s) => [s.section.code, s.expenses])).toEqual([['St-VA', 150]]);
    expect(store.unassignedRows().map((r) => r.id)).toEqual([5, 7]);
    store.excludedAccountIds.set(new Set([2]));
    expect(store.unassignedRows().map((r) => r.id)).toEqual([5]);
  });

  it('reports the findings, including the year-over-year comparison', () => {
    load(taxProfile({ employed: false, children: false, household: false, rental: false }));
    const findings = store.findings();
    expect(findings.unassigned.transactions).toHaveLength(2);
    // AB is always enabled and empty; SA stays enabled while unanswered.
    expect(findings.empty.map((s) => s.code)).toEqual(['St-SA', 'St-AB']);
    expect(findings.yearOverYear.map((f) => [f.section.code, f.current, f.previous])).toEqual([
      ['St-VA', 150, 400],
    ]);
    expect(store.openItems()).toBe(1 + 0 + 2 + 1);
  });

  it('keeps tag changes in a draft until saved, dropping values equal to the stored one', () => {
    load();
    store.setDraft(3, 'St-AB');
    store.setDraft(1, 'St-VA');
    expect([...store.pendingDraft()]).toEqual([[3, 'St-AB']]);
    expect(store.effectiveDraft(3).section?.code).toBe('St-AB');
    expect(store.report().sections.map((s) => s.section.code)).toEqual(['St-VA']);
    store.discardDraft();
    expect(store.pendingDraft().size).toBe(0);
  });

  it('suggests sections for untagged chains, and accepts or rejects them in the draft', () => {
    load();
    expect(store.suggestions().map((s) => [s.category.id, s.section.code])).toEqual([[3, 'St-AB']]);
    store.acceptAll();
    expect(store.draft().get(3)).toBe('St-AB');
    expect(store.suggestions()).toEqual([]);
    store.discardDraft();
    store.reject(store.suggestions()[0]);
    expect(store.suggestions()).toEqual([]);
  });

  it('lists the categories of the year that nothing tags, and the stored tag summary', () => {
    load();
    expect(store.reviewCategories().map((c) => c.id)).toEqual([3, 4]);
    expect(store.tagSummary()).toEqual({ sections: 1, categories: 1 });
    expect(store.hasTags()).toBe(true);
    expect(store.yearStats().get(2)).toEqual({ count: 1, income: 0, expenses: 50 });
  });

  it('saves the whole profile per answer and keeps a quick second answer', () => {
    load();
    store.answer('employed', true);
    store.answer('children', false);
    const first: TestRequest = http.expectOne('/api/settings/tax-profile');
    expect(first.request.method).toBe('PUT');
    expect(first.request.body.situations.employed).toBe(true);
    first.flush(null);
    const second: TestRequest = http.expectOne('/api/settings/tax-profile');
    expect(second.request.body.situations).toEqual({
      ...taxProfile().situations,
      employed: true,
      children: false,
    });
    second.flush(null);
    expect(store.situations()?.children).toBe(false);
  });

  it('saves the pending draft with the stored tags as expected, then prunes the draft', () => {
    load();
    store.setDraft(3, 'St-AB');
    store.setDraft(1, null);
    store.saveTags();
    expect(store.saving()).toBe(true);
    expect(() => store.saveTags()).toThrow('already being saved');
    // Edited while the save runs: stays in the draft afterwards.
    store.setDraft(4, 'St-0');

    const put: TestRequest = http.expectOne('/api/tax-tags');
    expect(put.request.method).toBe('PUT');
    expect((put.request.body as TaxTagsUpdateRequest).changes).toEqual([
      { category_id: 3, expected: null, next: 'St-AB' },
      { category_id: 1, expected: 'St-VA', next: null },
    ]);
    put.flush(null, { status: 204, statusText: 'No Content' });

    expect(store.saving()).toBe(false);
    expect(store.saveProblem()).toBeNull();
    expect([...store.draft()]).toEqual([[4, 'St-0']]);
    expect(store.storedTags().get(3)).toBe('St-AB');
    expect(store.storedTags().has(1)).toBe(false);
  });

  it('drops only the conflicting draft entries on a conflict, so the reloaded tags show', () => {
    load();
    store.setDraft(3, 'St-AB');
    store.setDraft(4, 'St-0');
    store.saveTags();
    http
      .expectOne('/api/tax-tags')
      .flush({ error: 'conflict', conflictIds: [3] }, { status: 409, statusText: 'Conflict' });
    http.expectOne('/api/tax-tags').flush([
      { category_id: 1, code: 'St-VA' },
      { category_id: 3, code: 'St-WK' },
    ]);

    expect(store.saving()).toBe(false);
    expect(store.saveProblem()).toEqual({ kind: 'conflict', categoryIds: [3] });
    expect([...store.draft()]).toEqual([[4, 'St-0']]);
    expect(store.storedTags().get(3)).toBe('St-WK');
    expect(store.effectiveDraft(3).section?.code).toBe('St-WK');
    expect(store.pendingDraft().has(3)).toBe(false);
  });

  it('reports and rethrows any other save error, keeping the draft', async () => {
    load();
    store.setDraft(3, 'St-AB');
    const unhandled: unknown[] = [];
    config.onUnhandledError = (cause: unknown): void => {
      unhandled.push(cause);
    };
    try {
      store.saveTags();
      http.expectOne('/api/tax-tags').flush('x', { status: 500, statusText: 'err' });
      // RxJS reports an error thrown in a subscriber on a later macrotask.
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      config.onUnhandledError = null;
    }
    expect(unhandled).toHaveLength(1);
    expect(store.saving()).toBe(false);
    expect(store.saveProblem()).toEqual({ kind: 'error' });
    expect(store.pendingDraft().get(3)).toBe('St-AB');
  });

  it('throws on a save without pending changes', () => {
    load();
    expect(() => store.saveTags()).toThrow('no tags to save');
  });

  it('throws while no year is chosen', () => {
    load();
    store.year.set(null);
    expect(() => store.report()).toThrow('no tax year chosen');
  });
});
