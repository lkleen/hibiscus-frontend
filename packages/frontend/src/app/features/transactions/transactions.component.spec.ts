import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { installMutationObserverMock } from '../../core/utils/testing/mutation-observer-mock';
import { account, transaction, transactionsResponse } from './testing/transaction-fixture';
import { TRANSACTIONS_ROUTES } from './transactions.routes';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('TransactionsComponent (shell)', () => {
  let httpMock: HttpTestingController;
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    installMutationObserverMock();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: ':locale/transactions', children: TRANSACTIONS_ROUTES }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => {
    httpMock.verify();
    vi.unstubAllGlobals();
  });

  async function settle(): Promise<void> {
    harness.detectChanges();
    await harness.fixture.whenStable();
    await wait(50);
    harness.detectChanges();
  }

  it('redirects to the list tab, renders tabs and controls, and fetches only once', async () => {
    await harness.navigateByUrl('/en/transactions');
    harness.detectChanges();
    httpMock.expectOne('/api/settings/date-presets').flush([]);
    httpMock.expectOne('/api/accounts').flush([account()]);
    httpMock.expectOne('/api/transactions').flush(transactionsResponse([transaction()]));
    httpMock.expectOne('/api/categories').flush([]);
    await settle();

    expect(TestBed.inject(Location).path()).toBe('/en/transactions/list');
    const root: HTMLElement = harness.routeNativeElement as HTMLElement;
    const tabs: string[] = Array.from(root.querySelectorAll('app-tab-nav a')).map(
      (a) => a.textContent?.trim() ?? '',
    );
    expect(tabs).toEqual(['List', 'By category']);
    expect(root.querySelector('app-account-filter')).not.toBeNull();
    expect(root.querySelector('#transactions-search')).not.toBeNull();
    expect(root.querySelector('app-date-range-filter')).not.toBeNull();
    expect(root.querySelector('app-transactions-list')).not.toBeNull();

    await TestBed.inject(Router).navigateByUrl('/en/transactions/categories');
    await settle();
    expect(root.querySelector('app-transactions-by-category')).not.toBeNull();
    // The by-category tree's expand/collapse-all buttons join the shell's toolbar row.
    const shellActions = (): string[] =>
      Array.from(
        root.querySelector('form.filters')?.querySelectorAll('.filters__action') ?? [],
      ).map((button) => button.getAttribute('aria-label') ?? '');
    expect(shellActions()).toEqual(['Expand all', 'Collapse all']);

    await TestBed.inject(Router).navigateByUrl('/en/transactions/list');
    await settle();
    expect(shellActions()).toEqual([]);
    // httpMock.verify() in afterEach fails on any further request.
    expect(root.querySelector('app-transactions-list')).not.toBeNull();
  });
});
