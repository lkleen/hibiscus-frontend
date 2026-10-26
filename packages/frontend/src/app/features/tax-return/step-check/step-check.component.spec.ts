import { HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { categoryRow } from '../../../core/utils/testing/category-row-fixture';
import { transaction } from '../../transactions/testing/transaction-fixture';
import { TaxReturnStore } from '../tax-return.store';
import { flushTaxLoad, taxProfile, taxReturnProviders } from '../testing/tax-return-testing';
import type { TaxStep } from '../wizard/tax-step';
import { StepCheckComponent } from './step-check.component';

describe('StepCheckComponent', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<StepCheckComponent>;
  let root: HTMLElement;
  let steps: TaxStep[];

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [StepCheckComponent],
      providers: taxReturnProviders(),
    });
    http = TestBed.inject(HttpTestingController);
    const store: TaxReturnStore = TestBed.inject(TaxReturnStore);
    flushTaxLoad(http, {
      profile: taxProfile({
        employed: false,
        children: false,
        household: false,
        rental: false,
        donations: false,
      }),
      categories: [
        categoryRow({ id: 1, name: 'Gesundheit', pattern: 'arzt' }),
        categoryRow({ id: 2, name: 'Versicherung', pattern: 'huk' }),
      ],
      tags: [
        { category_id: 1, code: 'St-AB' },
        { category_id: 2, code: 'St-VA' },
      ],
      transactions: [
        transaction({ id: 1, zweck: 'Arzt', betrag: -300, datum: '2025-02-01' }),
        transaction({ id: 2, zweck: 'Arzt Erstattung', betrag: 96, datum: '2025-03-01' }),
        transaction({ id: 3, zweck: 'Unknown', betrag: -10, datum: '2025-04-01' }),
        transaction({ id: 4, zweck: 'HUK', betrag: -500, datum: '2024-04-01' }),
      ],
    });
    store.year.set(2025);
    fixture = TestBed.createComponent(StepCheckComponent);
    root = fixture.nativeElement as HTMLElement;
    steps = [];
    fixture.componentInstance.go.subscribe((step: TaxStep) => steps.push(step));
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  function buttonByText(text: string): HTMLButtonElement {
    const found: HTMLButtonElement | undefined = Array.from(
      root.querySelectorAll<HTMLButtonElement>('button'),
    ).find((b) => (b.textContent ?? '').trim() === text);
    if (!found) throw new Error(`no button "${text}"`);
    return found;
  }

  it('lists every open item with its numbers', () => {
    const text: string = root.textContent ?? '';
    expect(text).toContain('Transactions without a category: 1');
    expect(text).toContain('Gesundheit has income and expenses');
    expect(text).toContain('Insurance and pension contributions, expenses');
    expect(text).toContain('Compared using your current tags applied to 2024.');
    // Always enabled, but nothing in 2025.
    expect(text).toContain('Insurance and pension contributions has no transactions');
    expect(text).not.toContain('Special expenses has no transactions');
  });

  it('offers a fix for each item', () => {
    buttonByText('Assign them').click();
    buttonByText('Review in the result').click();
    expect(steps).toEqual([2, 4]);

    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    buttonByText('Open 2024').click();
    expect(navigate).toHaveBeenCalledWith(['/', 'en', 'tax-return', 2024]);
  });
});
