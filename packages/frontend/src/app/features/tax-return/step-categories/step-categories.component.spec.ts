import { Dialog } from '@angular/cdk/dialog';
import { HttpTestingController, type TestRequest } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import type { TaxTag } from '@hibiscus-frontend/shared/contracts/tax-tags';
import { categoryRow } from '../../../core/utils/testing/category-row-fixture';
import { installMutationObserverMock } from '../../../core/utils/testing/mutation-observer-mock';
import { transaction } from '../../transactions/testing/transaction-fixture';
import { TaxReturnStore } from '../tax-return.store';
import { flushTaxLoad, taxReturnProviders } from '../testing/tax-return-testing';
import type { TaxStep } from '../wizard/tax-step';
import { StepCategoriesComponent } from './step-categories.component';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('StepCategoriesComponent', () => {
  let http: HttpTestingController;
  let store: TaxReturnStore;
  let fixture: ComponentFixture<StepCategoriesComponent>;
  let root: HTMLElement;
  let steps: TaxStep[];

  beforeEach(() => {
    installMutationObserverMock();
    TestBed.configureTestingModule({
      imports: [StepCategoriesComponent],
      providers: taxReturnProviders(),
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(TaxReturnStore);
  });

  afterEach(() => {
    TestBed.inject(Dialog).closeAll();
    fixture.destroy();
    http.verify();
  });

  async function render(categories: CategoryRow[], tags: TaxTag[] = []): Promise<void> {
    flushTaxLoad(http, {
      categories,
      tags,
      transactions: [
        transaction({ id: 1, zweck: 'Apo', betrag: -20, datum: '2025-03-05' }),
        transaction({ id: 2, zweck: 'Rewe', betrag: -30, datum: '2025-03-06' }),
      ],
    });
    store.year.set(2025);
    fixture = TestBed.createComponent(StepCategoriesComponent);
    root = fixture.nativeElement as HTMLElement;
    steps = [];
    fixture.componentInstance.go.subscribe((step: TaxStep) => steps.push(step));
    fixture.detectChanges();
    await fixture.whenStable();
    await wait(50);
    fixture.detectChanges();
  }

  function buttonByText(text: string): HTMLButtonElement {
    const found: HTMLButtonElement | undefined = Array.from(
      root.querySelectorAll<HTMLButtonElement>('button'),
    ).find((b) => (b.textContent ?? '').trim() === text);
    if (!found) throw new Error(`no button "${text}"`);
    return found;
  }

  function pickerTrigger(name: string): HTMLButtonElement {
    const found: HTMLButtonElement | null = root.querySelector(
      `button[aria-label="Tax section of ${name}"]`,
    );
    if (!found) throw new Error(`no picker for ${name}`);
    return found;
  }

  const UNTAGGED: CategoryRow[] = [
    categoryRow({ id: 1, name: 'Apotheke', pattern: 'apo' }),
    categoryRow({ id: 2, name: 'Lebensmittel', pattern: 'rewe' }),
  ];

  it('asks the life-situation questions and saves an answer', async () => {
    await render(UNTAGGED);
    expect(root.textContent).toContain('Your situation in 2025');
    buttonByText('Yes').click();
    const put: TestRequest = http.expectOne('/api/settings/tax-profile');
    expect(put.request.body.situations.employed).toBe(true);
    put.flush(null);
  });

  it('accepts a suggestion into the draft and saves the tags directly', async () => {
    await render(UNTAGGED);
    expect(root.textContent).toContain('Suggested tags');
    expect(buttonByText('Save tags').disabled).toBe(true);

    buttonByText('Accept').click();
    fixture.detectChanges();
    expect(store.pendingDraft().get(1)).toBe('St-AB');
    expect(root.textContent).toContain('Unsaved changes: 1');

    buttonByText('Save tags').click();
    fixture.detectChanges();
    expect(buttonByText('Saving…').disabled).toBe(true);
    expect(buttonByText('Discard').disabled).toBe(true);
    const put: TestRequest = http.expectOne('/api/tax-tags');
    expect(put.request.body).toEqual({
      changes: [{ category_id: 1, expected: null, next: 'St-AB' }],
    });
    put.flush(null, { status: 204, statusText: 'No Content' });
    fixture.detectChanges();
    expect(store.draft().size).toBe(0);
    expect(root.textContent).toContain('Unsaved changes: 0');
    expect(root.querySelector('[role="alert"]')).toBeNull();
  });

  it('names the conflicting categories and shows their reloaded tags after a conflict', async () => {
    await render(UNTAGGED);
    buttonByText('Accept').click();
    fixture.detectChanges();
    buttonByText('Save tags').click();
    http
      .expectOne('/api/tax-tags')
      .flush({ error: 'conflict', conflictIds: [1] }, { status: 409, statusText: 'Conflict' });
    http.expectOne('/api/tax-tags').flush([{ category_id: 1, code: 'St-0' }]);
    fixture.detectChanges();

    expect(root.querySelector('[role="alert"]')?.textContent).toContain(
      'the tax section of Apotheke was changed elsewhere',
    );
    expect(store.draft().has(1)).toBe(false);
    expect(pickerTrigger('Apotheke').textContent).toContain('Not tax-relevant');
    expect(buttonByText('Save tags').disabled).toBe(true);
  });

  it('puts a pick in the tree into the draft', async () => {
    await render(UNTAGGED);
    pickerTrigger('Lebensmittel').click();
    fixture.detectChanges();
    const option: HTMLElement | undefined = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    ).find((o) => (o.textContent ?? '').includes('Not tax-relevant'));
    if (!option) throw new Error('no option');
    option.click();
    expect(store.draft().get(2)).toBe('St-0');
  });

  it('does not select the table row when the picker is used', async () => {
    await render(UNTAGGED);
    const before: unknown = fixture.componentInstance['selectedRowId']();
    pickerTrigger('Lebensmittel').click();
    fixture.detectChanges();
    expect(fixture.componentInstance['selectedRowId']()).toBe(before);
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();
  });

  it('keeps step ② out of reach until a tag is saved', async () => {
    await render(UNTAGGED);
    expect(buttonByText('Continue').disabled).toBe(true);
  });

  it('opens collapsed to a summary in a later year', async () => {
    await render(UNTAGGED, [{ category_id: 1, code: 'St-AB' }]);
    expect(root.textContent).toContain('Sections in use: 1, categories tagged: 1');
    expect(root.textContent).toContain('have no section yet: 1');
    expect(root.textContent).not.toContain('Your situation');

    buttonByText('Continue').click();
    expect(steps).toEqual([2]);

    buttonByText('Review the new categories (1)').click();
    fixture.detectChanges();
    await wait(50);
    fixture.detectChanges();
    expect(root.textContent).toContain('Showing the new categories: 1');
  });
});
