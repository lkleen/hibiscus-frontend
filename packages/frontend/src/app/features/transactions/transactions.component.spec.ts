import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Dialog } from '@angular/cdk/dialog';
import { Location } from '@angular/common';
import { ApplicationRef } from '@angular/core';
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
    TestBed.inject(Dialog).closeAll();
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
    httpMock
      .expectOne('/api/settings/table-densities')
      .flush({ 'transactions-by-category': 'comfortable' });
    httpMock.expectOne('/api/transactions').flush(transactionsResponse([transaction()]));
    httpMock.expectOne('/api/categories').flush([]);
    await settle();

    expect(TestBed.inject(Location).path()).toBe('/en/transactions/list');
    const root: HTMLElement = harness.routeNativeElement as HTMLElement;
    const tabs: string[] = Array.from(root.querySelectorAll('app-tab-nav a')).map(
      (a) => a.textContent?.trim() ?? '',
    );
    expect(tabs).toEqual(['List', 'By category']);
    expect(root.querySelector('app-ribbon')).not.toBeNull();
    const ribbonTabs = (): string[] =>
      Array.from(root.querySelectorAll('.ribbon__tab')).map(
        (tab: Element): string => tab.firstChild?.textContent?.trim() ?? '',
      );
    expect(ribbonTabs()).toEqual(['Filter', 'Period', 'View', 'Export']);
    expect(root.querySelector('app-account-filter')).not.toBeNull();
    expect(root.querySelector('#transactions-search')).not.toBeNull();
    expect(root.querySelector('app-date-range-filter')).not.toBeNull();
    expect(root.querySelector('app-density-picker')).not.toBeNull();
    expect(root.querySelector('app-transactions-list')).not.toBeNull();
    const treeActions = (): string[] =>
      Array.from(root.querySelectorAll('.ribbon__band .filters__action[aria-label]')).map(
        (button: Element): string => button.getAttribute('aria-label') ?? '',
      );
    // The list has no tree: nothing in the View band's tree group.
    expect(treeActions()).toEqual([]);
    expect(root.querySelector('app-transactions-list app-data-table')?.className).toContain(
      'table-density-normal',
    );

    await TestBed.inject(Router).navigateByUrl('/en/transactions/categories');
    await settle();
    expect(root.querySelector('app-transactions-by-category')).not.toBeNull();
    // By category: the tree's expand/collapse-all buttons join the View band, and the table
    // follows that view's density.
    expect(treeActions()).toEqual(['Expand all', 'Collapse all']);
    expect(root.querySelector('app-transactions-by-category app-data-table')?.className).toContain(
      'table-density-comfortable',
    );

    await TestBed.inject(Router).navigateByUrl('/en/transactions/list');
    await settle();
    expect(treeActions()).toEqual([]);
    expect(ribbonTabs()).toEqual(['Filter', 'Period', 'View', 'Export']);
    // httpMock.verify() in afterEach fails on any further request.
    expect(root.querySelector('app-transactions-list')).not.toBeNull();
  });

  it("opens the export dialog for the active tab from the Export band's button", async () => {
    await harness.navigateByUrl('/en/transactions/categories');
    harness.detectChanges();
    httpMock.expectOne('/api/settings/date-presets').flush([]);
    httpMock.expectOne('/api/accounts').flush([account()]);
    httpMock.expectOne('/api/settings/table-densities').flush({});
    httpMock.expectOne('/api/transactions').flush(transactionsResponse([transaction()]));
    httpMock.expectOne('/api/categories').flush([]);
    await settle();

    const root: HTMLElement = harness.routeNativeElement as HTMLElement;
    const exportTab: HTMLElement | undefined = Array.from(
      root.querySelectorAll<HTMLElement>('.ribbon__tab'),
    ).find((tab: HTMLElement): boolean => tab.firstChild?.textContent?.trim() === 'Export');
    if (!exportTab) throw new Error('Export ribbon tab not rendered');
    exportTab.click();
    await settle();
    const open: HTMLButtonElement | undefined = Array.from(
      root.querySelectorAll<HTMLButtonElement>('.ribbon__band .filters__action'),
    ).find((button: HTMLButtonElement): boolean => button.textContent?.trim() === 'Export…');
    if (!open) throw new Error('Export… button not rendered');
    open.click();
    // Only a tick, no `settle()`: `whenStable` would wait for the preview's debounce and generate
    // a real PDF.
    TestBed.inject(ApplicationRef).tick();

    const dialog: HTMLElement | null = document.querySelector('app-export-dialog');
    expect(dialog?.textContent).toContain('Export by category');
    expect(dialog?.querySelector('.export-dialog__file')?.textContent).toContain(
      'transactions-by-category_',
    );
    // Closed before the preview's debounce generates a file.
    TestBed.inject(Dialog).closeAll();
  });
});
