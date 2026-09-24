import { registerLocaleData } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import localeDe from '@angular/common/locales/de';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Transaction } from '@hibiscus-frontend/shared/contracts/transactions';
import { LocaleService } from '../../core/services/locale.service';
import { installMutationObserverMock } from '../../core/utils/testing/mutation-observer-mock';
import { transaction } from './testing/transaction-fixture';
import { TransactionsComponent } from './transactions.component';

registerLocaleData(localeDe);

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('TransactionsComponent', () => {
  let fixture: ComponentFixture<TransactionsComponent>;
  let httpMock: HttpTestingController;
  let root: HTMLElement;

  beforeEach(() => {
    installMutationObserverMock();
    TestBed.configureTestingModule({
      imports: [TransactionsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(TransactionsComponent);
    httpMock = TestBed.inject(HttpTestingController);
    root = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    fixture.destroy();
    httpMock.verify();
    vi.unstubAllGlobals();
  });

  /** Lets the grid render what it was given. */
  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    await wait(50);
    fixture.detectChanges();
  }

  /** Starts the component and answers the initial accounts/categories requests. */
  function start(accounts: unknown[] = [], categories: unknown[] = []): void {
    fixture.detectChanges();
    httpMock.expectOne('/api/accounts').flush(accounts);
    httpMock.expectOne('/api/categories').flush(categories);
  }

  /** The transaction query is debounced (200ms) behind a signal->observable bridge. */
  async function expectTransactionsRequest(
    items: Transaction[],
    total: number,
  ): Promise<{ limit: string | null; offset: string | null; q: string | null }> {
    await wait(250);
    fixture.detectChanges();
    const req = httpMock.expectOne((r) => r.url === '/api/transactions');
    const params = {
      limit: req.request.params.get('limit'),
      offset: req.request.params.get('offset'),
      q: req.request.params.get('q'),
    };
    req.flush({ items, total });
    await settle();
    return params;
  }

  function pagerText(): string {
    return (
      root.querySelector('.pagination__status')?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    );
  }

  function clickPager(label: 'Previous' | 'Next', times = 1): void {
    const button = Array.from(root.querySelectorAll<HTMLButtonElement>('.pagination button')).find(
      (b) => b.textContent?.trim() === label,
    );
    if (!button) throw new Error(`pager button "${label}" not rendered`);
    for (let i = 0; i < times; i++) {
      button.click();
      fixture.detectChanges();
    }
  }

  it('renders the transactions returned by the API', async () => {
    start(
      [{ id: 1, name: 'Checking', iban: null, currency: 'EUR', balance: 100 }],
      [{ id: 1, name: 'Groceries', parentId: null, color: '#2f6f4f' }],
    );

    await expectTransactionsRequest(
      [
        transaction({
          empfaengerName: 'Supermarket',
          zweck: 'Weekly shop',
          umsatztypId: 1,
        }),
      ],
      1,
    );

    expect(root.querySelectorAll('.ag-row').length).toBe(1);
    const text = root.textContent ?? '';
    expect(text).toContain('Supermarket');
    expect(text).toContain('Weekly shop');
    expect(text).toContain('Checking');
    expect(text).toContain('Groceries');
    expect(text).toContain('2026-09-01');
  });

  it('shows an empty state when there are no matching transactions', async () => {
    start();

    await expectTransactionsRequest([], 0);

    expect(root.textContent).toContain('No transactions match these filters.');
    expect(root.querySelectorAll('.ag-row').length).toBe(0);
  });

  it('renders labels and amounts in the active locale', async () => {
    TestBed.inject(LocaleService).locale.set('de');
    start();

    await expectTransactionsRequest(
      [transaction({ empfaengerName: 'Supermarkt', betrag: -1234.5 })],
      1,
    );

    const text = root.textContent ?? '';
    expect(text).toContain('Umsätze');
    expect(text).toContain('-1.234,50');
    expect(text).toContain('Seite 1 von 1 (1 insgesamt)');
    const headers = Array.from(root.querySelectorAll('.ag-header-cell-text')).map((h) =>
      h.textContent?.trim(),
    );
    expect(headers).toEqual([
      'Datum',
      'Konto',
      'Gegenpartei / Verwendungszweck',
      'Betrag',
      'Kategorie',
    ]);
  });

  it('pages inside a loaded chunk without another request', async () => {
    start();
    const first = await expectTransactionsRequest([transaction()], 1000);

    expect(first).toMatchObject({ limit: '500', offset: '0' });
    expect(pagerText()).toBe('Page 1 of 50 (1000 total)');

    clickPager('Next');
    await wait(250);
    httpMock.expectNone((r) => r.url === '/api/transactions');

    expect(pagerText()).toBe('Page 2 of 50 (1000 total)');
  });

  it('fetches the next chunk when paging past the loaded one', async () => {
    start();
    await expectTransactionsRequest([transaction()], 1000);

    clickPager('Next', 25);

    const second = await expectTransactionsRequest([transaction({ id: 501 })], 1000);
    expect(second).toMatchObject({ limit: '500', offset: '500' });
    expect(pagerText()).toBe('Page 26 of 50 (1000 total)');
  });

  it('goes back to the first page and chunk when a filter changes', async () => {
    start();
    await expectTransactionsRequest([transaction()], 1000);
    clickPager('Next', 25);
    await expectTransactionsRequest([transaction({ id: 501 })], 1000);

    const search = root.querySelector<HTMLInputElement>('#filter-search');
    if (!search) throw new Error('search field not rendered');
    search.value = 'rent';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const filtered = await expectTransactionsRequest([transaction({ id: 2 })], 30);
    expect(filtered).toMatchObject({ limit: '500', offset: '0', q: 'rent' });
    expect(pagerText()).toBe('Page 1 of 2 (30 total)');
  });
});
