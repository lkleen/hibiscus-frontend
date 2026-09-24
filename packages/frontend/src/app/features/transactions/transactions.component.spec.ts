import { registerLocaleData } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import localeDe from '@angular/common/locales/de';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import type { GridApi } from 'ag-grid-community';
import { BaseTableComponent } from '../../core/components/base-table/base-table.component';
import type { Category } from '../../core/models/category.model';
import { LocaleService } from '../../core/services/locale.service';
import { installMutationObserverMock } from '../../core/utils/testing/mutation-observer-mock';
import type { TransactionsGridContext } from './cells/transactions-grid-context';
import { account, transaction } from './testing/transaction-fixture';
import { TransactionsComponent } from './transactions.component';

registerLocaleData(localeDe);

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Loaded {
  accounts?: AccountRow[];
  categories?: Category[];
  items?: TransactionRow[];
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

  /** Starts the component, answers its three requests and lets the grid render. */
  async function load({ accounts = [], categories = [], items = [] }: Loaded = {}): Promise<void> {
    fixture.detectChanges();
    httpMock.expectOne('/api/accounts').flush(accounts);
    httpMock.expectOne('/api/categories').flush(categories);
    httpMock.expectOne('/api/transactions').flush(items);
    await settle();
  }

  function grid(): GridApi<TransactionRow> {
    return (
      fixture.debugElement.query(By.directive(BaseTableComponent))
        .componentInstance as BaseTableComponent<TransactionRow>
    ).api;
  }

  function displayedIds(): number[] {
    const ids: number[] = [];
    grid().forEachNodeAfterFilterAndSort((node) => ids.push(node.data?.id ?? -1));
    return ids;
  }

  it('renders the transactions, with their account and category resolved', async () => {
    await load({
      accounts: [account({ id: 1, bezeichnung: 'Checking' })],
      categories: [{ id: 1, name: 'Groceries', parentId: null, color: '#2f6f4f' }],
      items: [
        transaction({
          empfaenger_name: 'Supermarket',
          zweck: 'Direct debit',
          zweck3: 'Weekly shop',
          umsatztyp_id: 1,
        }),
      ],
    });

    expect(root.querySelectorAll('.ag-row').length).toBe(1);
    const text = root.textContent ?? '';
    expect(text).toContain('Supermarket');
    expect(text).toContain('Direct debit');
    expect(text).toContain('Weekly shop');
    expect(text).toContain('Checking');
    expect(text).toContain('Groceries');
    expect(text).toContain('2026-09-01');
  });

  it('shows a dash in the columns a transaction has no value for', async () => {
    await load({ items: [transaction({ empfaenger_name: null, zweck: '', zweck3: null })] });

    const dashes = Array.from(root.querySelectorAll('.ag-cell')).filter(
      (cell) => cell.textContent?.trim() === '—',
    );
    // The four account columns (account unknown here) and every text column without a value fall
    // back to the dash: recipient name/account/bank, the three purposes, booking type, transaction
    // code, end-to-end id, balance.
    expect(dashes.length).toBe(14);
  });

  it("sizes the columns with ag-Grid's autoSizeStrategy, not fixed widths", async () => {
    await load({ items: [transaction()] });

    expect(grid().getGridOption('autoSizeStrategy')).toMatchObject({
      type: 'fitCellContents',
      continuous: true,
    });
    const columnDefs = grid().getGridOption('columnDefs') ?? [];
    // 18 shown columns plus the hidden `id` that only breaks sorting ties.
    expect(columnDefs.length).toBe(19);
    for (const def of columnDefs) {
      expect(def).not.toHaveProperty('width');
      expect(def).not.toHaveProperty('flex');
      expect(def).not.toHaveProperty('minWidth');
      expect(def).not.toHaveProperty('maxWidth');
    }
  });

  it('shows an empty state when there are no transactions', async () => {
    await load();

    expect(root.textContent).toContain('No transactions match these filters.');
    expect(root.querySelectorAll('.ag-row').length).toBe(0);
  });

  it('renders labels, amounts, filters and the pager in the active locale', async () => {
    TestBed.inject(LocaleService).locale.set('de');
    await load({ items: [transaction({ empfaenger_name: 'Supermarkt', betrag: -1234.5 })] });

    const text = root.textContent ?? '';
    expect(text).toContain('Umsätze');
    expect(text).toContain('-1.234,50');
    expect(text).toContain('Seite');
    const headers = Array.from(root.querySelectorAll('.ag-header-cell-text')).map((h) =>
      h.textContent?.trim(),
    );
    expect(headers).toEqual([
      'Datum',
      'Valuta',
      'Kontoinhaber',
      'Konto-BIC',
      'Kontonummer',
      'Kontobezeichnung',
      'Empfänger',
      'Empfängerkonto',
      'Empfänger-BIC/BLZ',
      'Verwendungszweck 1',
      'Verwendungszweck 2',
      'Verwendungszweck 3',
      'Buchungsart',
      'Geschäftsvorfallcode',
      'Ende-zu-Ende-Referenz',
      'Betrag',
      'Saldo',
      'Kategorie',
    ]);
    const pager: string = root.querySelector('.ag-paging-panel')?.textContent ?? '';
    expect(pager).toContain('Seitengröße:');
    expect(pager.replace(/\s+/g, ' ')).toContain('1 bis 1 von 1');
    expect(root.querySelectorAll('.ag-floating-filter').length).toBeGreaterThan(0);
  });

  it('loads every row with one request and pages inside the grid', async () => {
    const items: TransactionRow[] = Array.from({ length: 45 }, (_, i) =>
      transaction({ id: i + 1, datum: '2026-01-01' }),
    );
    await load({ items });

    expect(root.querySelectorAll('.ag-row').length).toBe(20);
    expect(grid().paginationGetTotalPages()).toBe(3);
    expect(grid().paginationGetRowCount()).toBe(45);
  });

  it('gives a negative balance the same theme-driven amount styling as the amount', async () => {
    await load({ items: [transaction({ betrag: -5, saldo: -101.95 })] });

    for (const colId of ['betrag', 'saldo']) {
      const cell = root.querySelector(`.ag-cell[col-id="${colId}"] app-transaction-amount-cell`);
      expect(cell?.classList).toContain('transaction-table__amount--negative');
    }
  });

  it('sorts the newest booking first, ties broken by the newest id', async () => {
    await load({
      items: [
        transaction({ id: 1, datum: '2026-01-01' }),
        transaction({ id: 2, datum: '2026-03-01' }),
        transaction({ id: 3, datum: '2026-03-01' }),
      ],
    });

    expect(displayedIds()).toEqual([3, 2, 1]);
  });

  it('sorts by a column when the user asks the grid to', async () => {
    await load({
      items: [
        transaction({ id: 1, betrag: 5 }),
        transaction({ id: 2, betrag: -20 }),
        transaction({ id: 3, betrag: 12 }),
      ],
    });

    const header = root.querySelector<HTMLElement>(
      '.ag-header-cell[col-id="betrag"] .ag-header-cell-label',
    );
    if (!header) throw new Error('amount column header not rendered');
    header.click();
    await settle();
    expect(displayedIds()).toEqual([2, 1, 3]);
  });

  it('filters with the quick filter over every column, including the account', async () => {
    await load({
      accounts: [
        account({ id: 1, bezeichnung: 'Checking' }),
        account({ id: 2, bezeichnung: 'Savings' }),
      ],
      items: [
        transaction({ id: 1, konto_id: 1, zweck: 'rent' }),
        transaction({ id: 2, konto_id: 1, zweck3: 'RENT for the garage' }),
        transaction({ id: 3, konto_id: 2, zweck: 'groceries' }),
      ],
    });

    const search = root.querySelector<HTMLInputElement>('#filter-search');
    if (!search) throw new Error('search field not rendered');
    search.value = 'rent';
    search.dispatchEvent(new Event('input'));
    await settle();
    expect(displayedIds().sort()).toEqual([1, 2]);

    search.value = 'savings';
    search.dispatchEvent(new Event('input'));
    await settle();
    expect(displayedIds()).toEqual([3]);
  });

  it('filters a column by its own value, dates included', async () => {
    await load({
      items: [
        transaction({ id: 1, datum: '2026-01-15' }),
        transaction({ id: 2, datum: '2026-02-15' }),
        transaction({ id: 3, datum: '2026-03-15' }),
      ],
    });

    grid().setFilterModel({
      datum: { filterType: 'date', type: 'greaterThan', dateFrom: '2026-02-01 00:00:00' },
    });

    expect(displayedIds().sort()).toEqual([2, 3]);
  });

  it('saves a changed category and applies it to the row the grid holds, staying on the page', async () => {
    const items: TransactionRow[] = Array.from({ length: 45 }, (_, i) =>
      transaction({ id: i + 1, datum: '2026-01-01' }),
    );
    await load({
      categories: [{ id: 7, name: 'Groceries', parentId: null, color: '#2f6f4f' }],
      items,
    });
    grid().paginationGoToPage(1);
    await settle();

    const context = grid().getGridOption('context') as TransactionsGridContext;
    context.changeCategory(20, 7);
    const req = httpMock.expectOne('/api/transactions/20');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ categoryId: 7 });
    req.flush(null, { status: 204, statusText: 'No Content' });
    await settle();

    expect(grid().getRowNode('20')?.data?.umsatztyp_id).toBe(7);
    expect(grid().paginationGetCurrentPage()).toBe(1);
  });
});
