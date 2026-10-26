import { Dialog } from '@angular/cdk/dialog';
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import type { TaxTag } from '@hibiscus-frontend/shared/contracts/tax-tags';
import { categoryRow } from '../../../core/utils/testing/category-row-fixture';
import { installMutationObserverMock } from '../../../core/utils/testing/mutation-observer-mock';
import { transaction } from '../../transactions/testing/transaction-fixture';
import { TaxReturnStore } from '../tax-return.store';
import { taxYearGuard } from '../tax-year';
import { flushTaxLoad, taxReturnProviders } from '../testing/tax-return-testing';
import { TaxWizardComponent } from './tax-wizard.component';

describe('TaxWizardComponent', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    installMutationObserverMock();
    TestBed.configureTestingModule({
      providers: [
        ...taxReturnProviders(),
        provideRouter([
          { path: ':locale/tax-return', children: [] },
          {
            path: ':locale/tax-return/:year',
            canActivate: [taxYearGuard],
            component: TaxWizardComponent,
          },
        ]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(TaxReturnStore);
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => {
    TestBed.inject(Dialog).closeAll();
    http.verify();
  });

  async function open(categories: CategoryRow[], tags: TaxTag[] = []): Promise<HTMLElement> {
    flushTaxLoad(http, {
      categories,
      tags,
      transactions: [transaction({ id: 1, zweck: 'Apo', datum: '2025-03-05' })],
    });
    await harness.navigateByUrl('/en/tax-return/2025', TaxWizardComponent);
    harness.detectChanges();
    return harness.routeNativeElement as HTMLElement;
  }

  function stepButtons(root: HTMLElement): HTMLButtonElement[] {
    return Array.from(root.querySelectorAll<HTMLButtonElement>('.tax-steps__button'));
  }

  it('shows the year, the steps and the note, with steps ②–④ locked until a tag exists', async () => {
    const root: HTMLElement = await open([
      categoryRow({ id: 1, name: 'Apotheke', pattern: 'apo' }),
    ]);
    expect(root.textContent).toContain('Tax return 2025');
    expect(root.textContent).toContain('No tax advice.');
    expect(stepButtons(root).map((b) => b.disabled)).toEqual([false, true, true, true]);
    expect(stepButtons(root)[0].getAttribute('aria-current')).toBe('step');
    expect(TestBed.inject(TaxReturnStore).year()).toBe(2025);
  });

  it('moves freely between the steps once a category is tagged', async () => {
    const root: HTMLElement = await open(
      [categoryRow({ id: 1, name: 'Apotheke', pattern: 'apo' })],
      [{ category_id: 1, code: 'St-AB' }],
    );
    expect(stepButtons(root).map((b) => b.disabled)).toEqual([false, false, false, false]);
    stepButtons(root)[3].click();
    harness.detectChanges();
    expect(root.querySelector('app-tax-step-result')).not.toBeNull();
    expect(stepButtons(root)[3].getAttribute('aria-current')).toBe('step');
  });

  it('sends an invalid year back to the picker', async () => {
    flushTaxLoad(http);
    await harness.navigateByUrl('/en/tax-return/20x5');
    expect(TestBed.inject(TaxReturnStore).year()).toBeNull();
    expect(harness.routeNativeElement?.querySelector('app-tax-wizard') ?? null).toBeNull();
  });
});
