import { HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import type { TaxTag } from '@hibiscus-frontend/shared/contracts/tax-tags';
import { categoryRow } from '../../../core/utils/testing/category-row-fixture';
import { account, transaction } from '../../transactions/testing/transaction-fixture';
import { TaxReturnStore } from '../tax-return.store';
import { flushTaxLoad, taxReturnProviders } from '../testing/tax-return-testing';
import { TaxYearPickerComponent } from './tax-year-picker.component';

describe('TaxYearPickerComponent', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<TaxYearPickerComponent>;
  let root: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-01T12:00:00'));
    TestBed.configureTestingModule({
      imports: [TaxYearPickerComponent],
      providers: taxReturnProviders(),
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(TaxReturnStore);
  });

  afterEach(() => {
    vi.useRealTimers();
    http.verify();
  });

  function render(categories: CategoryRow[], tags: TaxTag[] = []): void {
    flushTaxLoad(http, {
      tags,
      accounts: [account({ id: 1, bezeichnung: 'Giro' }), account({ id: 2, bezeichnung: 'Firma' })],
      categories,
      transactions: [
        transaction({ id: 1, datum: '2026-01-02' }),
        transaction({ id: 2, datum: '2025-05-02' }),
        transaction({ id: 3, datum: '2025-06-02', konto_id: 2 }),
        transaction({ id: 4, datum: '2024-06-02' }),
      ],
    });
    fixture = TestBed.createComponent(TaxYearPickerComponent);
    root = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  }

  function yearButtons(): HTMLButtonElement[] {
    return Array.from(root.querySelectorAll<HTMLButtonElement>('.tax-picker__year'));
  }

  it('offers the years with transactions and starts on the last calendar year', () => {
    render([]);
    expect(yearButtons().map((b) => b.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      '2026Transactions: 1',
      '2025Transactions: 2',
      '2024Transactions: 1',
    ]);
    expect(yearButtons()[1].getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('app-account-filter')).not.toBeNull();
  });

  it('shows the intro on the first run only', () => {
    render([]);
    expect(root.textContent).toContain('What you get');
  });

  it('hides the intro once a category carries a tax tag', () => {
    render([categoryRow({ id: 1 })], [{ category_id: 1, code: 'St-VA' }]);
    expect(root.textContent).not.toContain('What you get');
  });

  it('continues with the picked year', () => {
    render([]);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    yearButtons()[2].click();
    fixture.detectChanges();
    const go: HTMLButtonElement | null = root.querySelector('.tax-button--primary');
    expect(go?.textContent?.trim()).toBe('Continue with 2024');
    go?.click();
    expect(navigate).toHaveBeenCalledWith(['/', 'en', 'tax-return', 2024]);
  });
});
