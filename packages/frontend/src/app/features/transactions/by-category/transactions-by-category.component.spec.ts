import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { MockInstance } from 'vitest';
import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import type { TableViewId } from '@hibiscus-frontend/shared/contracts/user-settings';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import { categoryRow } from '../../../core/utils/testing/category-row-fixture';
import { installMutationObserverMock } from '../../../core/utils/testing/mutation-observer-mock';
import { RibbonHost } from '../../../shared/components/ribbon/ribbon-host';
import { RibbonComponent } from '../../../shared/components/ribbon/ribbon.component';
import { TransactionDialogs } from '../transaction-dialogs';
import { TransactionsExport } from '../export/transactions-export';
import { CategoryDialogs } from '../../categories/category-dialogs';
import { account, transaction, transactionsResponse } from '../testing/transaction-fixture';
import { TransactionsStore } from '../transactions.store';
import { TransactionsByCategoryComponent } from './transactions-by-category.component';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const DENSITY_VIEW: TableViewId = 'transactions-by-category';

interface Loaded {
  accounts?: AccountRow[];
  items?: TransactionRow[];
  categories?: CategoryRow[];
}

describe('TransactionsByCategoryComponent', () => {
  let fixture: ComponentFixture<TransactionsByCategoryComponent>;
  let httpMock: HttpTestingController;
  let ribbon: ComponentFixture<RibbonComponent>;
  let root: HTMLElement;

  beforeEach(() => {
    installMutationObserverMock();
    TestBed.configureTestingModule({
      imports: [TransactionsByCategoryComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        RibbonHost,
        TransactionsStore,
        TransactionDialogs,
        TransactionsExport,
        CategoryDialogs,
      ],
    });
    fixture = TestBed.createComponent(TransactionsByCategoryComponent);
    httpMock = TestBed.inject(HttpTestingController);
    root = fixture.nativeElement as HTMLElement;
    // The selection band is registered by the table's tab; the ribbon renders it.
    ribbon = TestBed.createComponent(RibbonComponent);
    ribbon.componentRef.setInput('ribbonId', 'test');
  });

  afterEach(() => {
    ribbon.destroy();
    fixture.destroy();
    httpMock.verify();
  });

  async function load({
    accounts = [account({ id: 1 })],
    items = [],
    categories = [],
  }: Loaded = {}): Promise<void> {
    fixture.detectChanges();
    httpMock.expectOne('/api/accounts').flush(accounts);
    httpMock.expectOne('/api/settings/table-densities').flush({ [DENSITY_VIEW]: 'compact' });
    httpMock.expectOne('/api/transactions').flush(transactionsResponse(items));
    httpMock.expectOne('/api/categories').flush(categories);
    fixture.detectChanges();
    await fixture.whenStable();
    await wait(50);
    fixture.detectChanges();
  }

  function rowTexts(): string[] {
    return Array.from(root.querySelectorAll<HTMLElement>('tbody tr')).map((row) =>
      (row.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
  }

  it("binds the table to the user's density for this view", async () => {
    await load();
    expect(root.querySelector('app-data-table')?.classList.contains('table-density-compact')).toBe(
      true,
    );
  });

  it('shows categories with their summed amounts and the unassigned node', async () => {
    await load({
      categories: [categoryRow({ id: 1, name: 'Housing', pattern: 'rent' })],
      items: [
        transaction({ id: 1, zweck: 'rent', betrag: -100 }),
        transaction({ id: 2, zweck: 'rent', betrag: -50 }),
        transaction({ id: 3, zweck: 'other', betrag: 20 }),
      ],
    });

    const rows: string[] = rowTexts();
    expect(rows.length).toBe(2);
    const housing: string | undefined = rows.find((row) => row.includes('Housing'));
    expect(housing).toContain('-150.00');
    const unassigned: string | undefined = rows.find((row) => row.includes('Unassigned'));
    expect(unassigned).toContain('20.00');
  });

  it('shows a swatch in the custom colour of a category, and none elsewhere', async () => {
    await load({
      categories: [
        categoryRow({ id: 1, name: 'Housing', pattern: 'rent', color: '10,20,30', customcolor: 1 }),
        categoryRow({ id: 2, name: 'Food', pattern: 'shop', color: '10,20,30', customcolor: 0 }),
      ],
      items: [
        transaction({ id: 1, zweck: 'rent', betrag: -100 }),
        transaction({ id: 2, zweck: 'shop', betrag: -5 }),
      ],
    });

    const swatches: HTMLElement[] = Array.from(
      root.querySelectorAll<HTMLElement>('.by-category__swatch'),
    );
    expect(swatches.length).toBe(1);
    expect(swatches[0].closest('tr')?.textContent).toContain('Housing');
    expect(swatches[0].style.backgroundColor).toBe('rgb(10 20 30)');
  });

  it('shows the unassigned node with 0 when nothing is unassigned', async () => {
    await load();

    const rows: string[] = rowTexts();
    expect(rows.length).toBe(1);
    expect(rows[0]).toContain('Unassigned');
    expect(rows[0]).toContain('0.00');
  });

  it('warns about invalid regex patterns, naming the categories', async () => {
    await load({
      categories: [categoryRow({ id: 1, name: 'Broken', pattern: '(', isregex: 1 })],
      items: [transaction({ id: 1 })],
    });

    const warning: HTMLElement | null = root.querySelector('.by-category__warning');
    expect(warning?.textContent).toContain('Broken');
  });

  it('opens View with the full transaction details on a transaction, no menu on a category', async () => {
    await load({ items: [transaction({ id: 1, zweck: 'Bakery', kommentar: 'Noted' })] });

    function rightClick(cell: Element): MouseEvent {
      const event: MouseEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      cell.dispatchEvent(event);
      return event;
    }
    function overlay(selector: string): HTMLElement[] {
      return Array.from(document.querySelectorAll<HTMLElement>(selector));
    }

    const categoryCell: Element | null = root.querySelector('tbody tr td:nth-child(2)');
    if (!categoryCell) throw new Error('category row not rendered');
    expect(rightClick(categoryCell).defaultPrevented).toBe(false);
    expect(overlay('.data-table-menu').length).toBe(0);

    const toggler: HTMLElement | null = root.querySelector<HTMLElement>('tbody tr button');
    if (!toggler) throw new Error('tree toggler not rendered');
    toggler.click();
    fixture.detectChanges();
    await wait(50);
    fixture.detectChanges();

    const leafCell: Element | undefined = root.querySelectorAll('tbody tr')[1]?.children[1];
    if (!leafCell) throw new Error('transaction row not rendered');
    expect(rightClick(leafCell).defaultPrevented).toBe(true);
    fixture.detectChanges();
    await wait(50);
    const show: HTMLElement | undefined = overlay('[cdkMenuItem]').find(
      (el: HTMLElement) => el.textContent?.trim() === 'View',
    );
    if (!show) throw new Error('View menu item not rendered');
    expect(overlay('[cdkMenuItem]').map((el: HTMLElement) => el.textContent?.trim())).toEqual([
      'View',
      'Edit',
      'Assign',
      'Create category',
    ]);
    expect(overlay('[cdkMenuItem]')[2].getAttribute('title')).toBe(
      'Assign this transaction to a category, or remove its category',
    );
    show.click();
    fixture.detectChanges();
    await wait(50);
    fixture.detectChanges();

    const labels: HTMLElement[] = overlay('.data-table-details__label');
    const values: string[] = overlay('.data-table-details__value').map(
      (el: HTMLElement) => el.textContent?.trim() ?? '',
    );
    expect(labels.length).toBe(20);
    expect(values).toContain('Bakery');
    expect(values).toContain('Noted');
    overlay('.data-table-details__close')[0].click();
  });

  it('offers only Edit on a category node, which opens its dialog; the Unassigned node has no menu', async () => {
    const housing: CategoryRow = categoryRow({ id: 1, name: 'Housing', pattern: 'rent' });
    await load({
      categories: [housing],
      items: [
        transaction({ id: 1, zweck: 'rent', betrag: -100 }),
        transaction({ id: 2, zweck: 'other', betrag: 20 }),
      ],
    });
    const dialogs: CategoryDialogs = TestBed.inject(CategoryDialogs);
    const store: TransactionsStore = TestBed.inject(TransactionsStore);
    const openEdit: MockInstance<CategoryDialogs['openEdit']> = vi
      .spyOn(dialogs, 'openEdit')
      .mockImplementation(() => undefined);

    function contextMenu(row: number): HTMLElement[] {
      const cell: Element | undefined = root.querySelectorAll('tbody tr')[row]?.children[1];
      if (!cell) throw new Error('row not rendered');
      cell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      fixture.detectChanges();
      return Array.from(document.querySelectorAll<HTMLElement>('[cdkMenuItem]'));
    }

    const housingItems: HTMLElement[] = contextMenu(0);
    expect(housingItems.map((el: HTMLElement) => el.textContent?.trim())).toEqual(['Edit']);
    housingItems[0].click();
    fixture.detectChanges();
    expect(openEdit).toHaveBeenCalledWith(store, housing);

    expect(contextMenu(1)).toEqual([]);
    expect(openEdit).toHaveBeenCalledTimes(1);
  });

  it('shows no warning when every pattern is valid', async () => {
    await load({ categories: [categoryRow({ id: 1, pattern: 'x' })] });

    expect(root.querySelector('.by-category__warning')).toBeNull();
  });

  describe('bulk assign', () => {
    const tx = (id: number): TransactionRow =>
      transaction({ id, zweck: `Tx ${id}`, umsatztyp_id: null, kommentar: `N${id}` });

    function ribbonEl(): HTMLElement {
      return ribbon.nativeElement as HTMLElement;
    }

    async function settle(): Promise<void> {
      fixture.detectChanges();
      ribbon.detectChanges();
      await wait(50);
      fixture.detectChanges();
      ribbon.detectChanges();
    }
    function leafBoxes(): HTMLInputElement[] {
      return Array.from(root.querySelectorAll<HTMLInputElement>('tbody tr .data-table__checkbox'));
    }
    async function expandAndTick(count: number): Promise<void> {
      const toggler: HTMLElement | null = root.querySelector<HTMLElement>('tbody tr button');
      if (!toggler) throw new Error('tree toggler not rendered');
      toggler.click();
      await settle();
      const boxes: HTMLInputElement[] = leafBoxes();
      expect(boxes.length).toBeGreaterThanOrEqual(count);
      for (const box of boxes.slice(0, count)) box.click();
      await settle();
    }
    /** The contextual Selection band's tab and its group, as rendered by the ribbon. */
    function selectionTab(): HTMLElement | null {
      return ribbonEl().querySelector<HTMLElement>('.ribbon__tab--contextual');
    }
    function isIdle(): boolean {
      return selectionTab() === null;
    }
    function menu(row: number): HTMLElement[] {
      const cell: Element | undefined = root.querySelectorAll('tbody tr')[row]?.children[1];
      if (!cell) throw new Error('row not rendered');
      cell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      fixture.detectChanges();
      return Array.from(document.querySelectorAll<HTMLElement>('[cdkMenuItem]'));
    }

    it('only transaction leaves have a checkbox; ticking shows the count and Clear empties it', async () => {
      await load({ items: [tx(1), tx(2)] });
      expect(leafBoxes().length).toBe(0);
      await expandAndTick(2);
      expect(ribbonEl().querySelector('.selection-bar__count')?.textContent).toContain(
        '2 selected',
      );
      expect(selectionTab()?.textContent).toContain('Selection');
      expect(selectionTab()?.querySelector('.ribbon__state')?.textContent?.trim()).toBe('2');
      const clear: HTMLButtonElement | undefined = Array.from(
        ribbonEl().querySelectorAll<HTMLButtonElement>('.filters__action'),
      ).find((el: HTMLButtonElement) => el.textContent?.trim() === 'Clear selection');
      if (!clear) throw new Error('Clear button not rendered');
      clear.click();
      await settle();
      expect(isIdle()).toBe(true);
    });

    it('View and Edit are disabled on a selected row and Assign saves the selection, then clears it', async () => {
      await load({ items: [tx(1), tx(2)], categories: [categoryRow({ id: 4, name: 'Food' })] });
      await expandAndTick(2);
      const items: HTMLElement[] = menu(1);
      expect(items.map((el: HTMLElement) => el.getAttribute('aria-disabled'))).toEqual([
        'true',
        'true',
        null,
        'true',
      ]);
      items[2].click();
      await settle();
      const dialog: HTMLElement | null = document.querySelector('app-transaction-assign-dialog');
      if (!dialog) throw new Error('assign dialog not rendered');
      expect(dialog.textContent).toContain('2 transactions');
      const food: HTMLElement | undefined = Array.from(
        dialog.querySelectorAll<HTMLElement>('tbody tr'),
      ).find((el: HTMLElement) => el.textContent?.trim() === 'Food');
      if (!food) throw new Error('category row not rendered');
      food.click();
      await settle();
      const request = httpMock.expectOne({
        method: 'POST',
        url: '/api/transactions/assign-category',
      });
      expect((request.request.body as { items: unknown[] }).items.length).toBe(2);
      request.flush(null, { status: 204, statusText: 'No Content' });
      await settle();
      expect(isIdle()).toBe(true);
      expect(document.querySelector('app-transaction-assign-dialog')).toBeNull();
    });

    it('a row outside the selection keeps the single-row menu', async () => {
      await load({ items: [tx(1), tx(2), tx(3)] });
      await expandAndTick(2);
      const items: HTMLElement[] = menu(3);
      expect(items.map((el: HTMLElement) => el.getAttribute('aria-disabled'))).toEqual([
        null,
        null,
        null,
        null,
      ]);
    });
  });
});
