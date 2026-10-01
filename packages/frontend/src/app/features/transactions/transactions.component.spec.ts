import { registerLocaleData } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import localeDe from '@angular/common/locales/de';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import type { Category } from '../../core/models/category.model';
import { LocaleService } from '../../core/services/locale.service';
import { installMutationObserverMock } from '../../core/utils/testing/mutation-observer-mock';
import { account, transaction, transactionsResponse } from './testing/transaction-fixture';
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

// Column order in the `#body` template — used to pick a cell out of a row by index rather than
// by a DOM hook the implementation doesn't have.
const COL = {
  datum: 0,
  valuta: 1,
  zweck: 9,
  betrag: 15,
  saldo: 16,
  category: 17,
} as const;

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

  /** Lets PrimeNG render what it was given. */
  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    await wait(50);
    fixture.detectChanges();
  }

  /** Starts the component, answers its three requests and lets the table render. */
  async function load({ accounts = [], categories = [], items = [] }: Loaded = {}): Promise<void> {
    fixture.detectChanges();
    // No presets, so the date filter stays on "All dates" and every row is visible.
    httpMock.expectOne('/api/settings/date-presets').flush([]);
    httpMock.expectOne('/api/accounts').flush(accounts);
    httpMock.expectOne('/api/categories').flush(categories);
    httpMock.expectOne('/api/transactions').flush(transactionsResponse(items));
    await settle();
  }

  /** Real data rows only — `#emptymessage` also renders a `<tr>` in `tbody`, distinguishable by
   *  its single colspan'd cell. */
  function bodyRows(): HTMLTableRowElement[] {
    return Array.from(root.querySelectorAll<HTMLTableRowElement>('tbody tr')).filter(
      (row) => !row.querySelector('td[colspan]'),
    );
  }

  function cellText(row: HTMLTableRowElement, col: number): string {
    return row.children[col]?.textContent?.trim() ?? '';
  }

  /** A header cell's own label text, ignoring the `<p-sortIcon>` element after it (which, for a
   *  column that's part of a multi-column sort, also renders a priority badge — e.g. "1" for
   *  `datum` here — that would otherwise leak into the label). */
  function headerLabel(th: Element): string {
    return Array.from(th.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? '')
      .join('')
      .trim();
  }

  /** Reads the rendered row order out of the DOM — the fixture puts the row's own id in `zweck`
   *  wherever a test needs to tell rows apart by order, so this is just reading that column. */
  function displayedIds(): number[] {
    return bodyRows().map((row) => Number(cellText(row, COL.zweck)));
  }

  /** Finds the row whose `zweck` cell reads `id`, for tests that only care about one row among
   *  many (e.g. paging, category updates). */
  function rowById(id: number): HTMLTableRowElement {
    const row = bodyRows().find((r) => cellText(r, COL.zweck) === String(id));
    if (!row) throw new Error(`row ${id} not rendered`);
    return row;
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

    expect(bodyRows().length).toBe(1);
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

    const dashes = Array.from(root.querySelectorAll('tbody td')).filter(
      (cell) => cell.textContent?.trim() === '—',
    );
    // The four account columns (account unknown here) and every text column without a value fall
    // back to the dash: recipient name/account/bank, the three purposes, booking type, transaction
    // code, end-to-end id, balance.
    expect(dashes.length).toBe(14);
  });

  it('sizes the table with a min-width hint and no per-column fixed widths', async () => {
    await load({ items: [transaction()] });

    // ag-Grid's `autoSizeStrategy` has no PrimeNG equivalent; column sizing is now just the
    // `[tableStyle]` hint plus the browser's own table auto-layout.
    const table = root.querySelector<HTMLTableElement>('table');
    if (!table) throw new Error('table not rendered');
    expect(table.style.minWidth).toBeTruthy();
    // fitCellContents strategy sets the table to max-content width for single-line cells.
    expect(table.style.width).toBe('max-content');

    const headerCells = Array.from(root.querySelectorAll('thead tr:first-child th'));
    expect(headerCells.length).toBe(18);
    for (const cell of headerCells) {
      expect((cell as HTMLElement).style.width).toBe('');
      expect((cell as HTMLElement).getAttribute('width')).toBeNull();
    }
  });

  it('shows an empty state when there are no transactions', async () => {
    await load();

    expect(root.textContent).toContain('No transactions match these filters.');
    expect(bodyRows().length).toBe(0);
  });

  it('renders labels, amounts, filters and the pager in the active locale', async () => {
    TestBed.inject(LocaleService).locale.set('de');
    await load({ items: [transaction({ empfaenger_name: 'Supermarkt', betrag: -1234.5 })] });

    const text = root.textContent ?? '';
    expect(text).toContain('Umsätze');
    expect(text).toContain('-1.234,50');
    const headers = Array.from(root.querySelectorAll('thead tr:first-child th')).map(headerLabel);
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
    // The old German pager showed a visible "Seitengröße:" label; PrimeNG's rows-per-page
    // dropdown is ARIA-labelled only, so that exact string no longer appears anywhere — the
    // report line is the one localised, visible pager string left to assert.
    const report = root.querySelector('.p-paginator-current')?.textContent ?? '';
    expect(report.replace(/\s+/g, ' ').trim()).toBe('1 bis 1 von 1');
    expect(root.querySelectorAll('.p-datatable-filter').length).toBeGreaterThan(0);
  });

  it('loads every row with one request and pages inside the table', async () => {
    const items: TransactionRow[] = Array.from({ length: 45 }, (_, i) =>
      transaction({ id: i + 1, datum: '2026-01-01' }),
    );
    await load({ items });

    expect(bodyRows().length).toBe(20);
    const report = root.querySelector('.p-paginator-current')?.textContent ?? '';
    expect(report.replace(/\s+/g, ' ').trim()).toBe('1 to 20 of 45');
  });

  it('gives a negative balance the same theme-driven amount styling as the amount', async () => {
    await load({ items: [transaction({ betrag: -5, saldo: -101.95 })] });

    const cells = root.querySelectorAll('.data-table__col--end app-transaction-amount-cell');
    expect(cells.length).toBe(2);
    for (const cell of Array.from(cells)) {
      expect(cell.classList).toContain('transaction-table__amount--negative');
    }
  });

  it('sorts the newest booking first, ties broken by the newest id', async () => {
    await load({
      items: [
        transaction({ id: 1, datum: '2026-01-01', zweck: '1' }),
        transaction({ id: 2, datum: '2026-03-01', zweck: '2' }),
        transaction({ id: 3, datum: '2026-03-01', zweck: '3' }),
      ],
    });

    expect(displayedIds()).toEqual([3, 2, 1]);
  });

  it('sorts by a column when the user clicks its header', async () => {
    await load({
      items: [
        transaction({ id: 1, betrag: 5, zweck: '1' }),
        transaction({ id: 2, betrag: -20, zweck: '2' }),
        transaction({ id: 3, betrag: 12, zweck: '3' }),
      ],
    });

    // `<app-data-table>` binds `[pSortableColumn]="column.colId"` (it has to — the column list is
    // data, not markup authored per column) rather than the old template's static
    // `pSortableColumn="betrag"` attribute, so it isn't reflected onto the DOM element for an
    // attribute selector to find; the amount column's known header position stands in for it.
    const header = Array.from(root.querySelectorAll<HTMLElement>('thead tr:first-child th'))[
      COL.betrag
    ];
    if (!header) throw new Error('amount column header not rendered');
    header.click();
    await settle();
    expect(displayedIds()).toEqual([2, 1, 3]);
  });

  it('filters with the global search over every column, including the account', async () => {
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
    expect(bodyRows().length).toBe(2);
    expect(root.textContent).not.toContain('groceries');

    search.value = 'savings';
    search.dispatchEvent(new Event('input'));
    await settle();
    expect(bodyRows().length).toBe(1);
    expect(root.textContent).toContain('Savings');
  });

  it('filters a date column on its own value without throwing on the ISO string', async () => {
    // The regression this guards: PrimeNG's date filter emits a `Date` and `FilterService`
    // calls `.toDateString()` on the cell value — which throws if that value is still the raw
    // ISO string. The view row carries a separate `datum_date: Date` for exactly this reason.
    await load({
      items: [
        transaction({ id: 1, datum: '2026-01-15' }),
        transaction({ id: 2, datum: '2026-02-15' }),
        transaction({ id: 3, datum: '2026-03-15' }),
      ],
    });

    const dateInput = root.querySelector<HTMLInputElement>(
      'thead tr:nth-child(2) th:first-child input',
    );
    if (!dateInput) throw new Error('date filter input not rendered');

    // The PrimeNG datepicker's own input parses on `input`, but only after a `keydown` has set
    // its internal "user is typing" flag — mirroring a real keystroke, not just setting `.value`.
    const filter = (): void => {
      dateInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
      dateInput.value = '02/15/2026';
      dateInput.dispatchEvent(new Event('input', { bubbles: true }));
    };
    expect(filter).not.toThrow();
    await settle();

    expect(bodyRows().length).toBe(1);
    expect(root.textContent).toContain('2026-02-15');
    expect(root.textContent).not.toContain('2026-01-15');
    expect(root.textContent).not.toContain('2026-03-15');
  });

  it('saves a changed category through the picker and applies it to the row, staying on the page', async () => {
    const items: TransactionRow[] = Array.from({ length: 45 }, (_, i) =>
      transaction({ id: i + 1, datum: '2026-01-01', zweck: String(i + 1) }),
    );
    await load({
      categories: [{ id: 7, name: 'Groceries', parentId: null, color: '#2f6f4f' }],
      items,
    });

    const next = root.querySelector<HTMLButtonElement>('.p-paginator-next');
    if (!next) throw new Error('paginator next button not rendered');
    next.click();
    await settle();
    // Newest-first default sort: page 1 shows ids 45..26, page 2 shows 25..6.
    expect(displayedIds()[0]).toBe(25);

    const row = rowById(25);
    row.querySelector<HTMLButtonElement>('.category-picker__trigger')?.click();
    fixture.detectChanges();
    const option = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.category-picker__option'),
    ).find((o) => o.textContent?.includes('Groceries'));
    if (!option) throw new Error('category option not rendered');
    option.click();
    fixture.detectChanges();

    const req = httpMock.expectOne('/api/transactions/25');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ categoryId: 7 });
    req.flush(null, { status: 204, statusText: 'No Content' });
    await settle();

    expect(cellText(rowById(25), COL.category)).toContain('Groceries');
    // Still on the second page, which still starts at 25 — the category update mutates the row in
    // place rather than replacing the `[value]` array, so PrimeNG never sees a new array identity
    // that would otherwise reset pagination to page 1 (which would show 45 here).
    expect(displayedIds()[0]).toBe(25);
  });

  it('keeps a category change visible on a row while a filter is active', async () => {
    // PrimeNG renders `filteredValue` while a filter is active, which holds the *same row
    // references* as the unfiltered array — replacing the row object on update would leave the
    // stale object sitting in `filteredValue`, invisible to this test unless a filter narrows
    // the rendered set first.
    await load({
      categories: [{ id: 7, name: 'Groceries', parentId: null, color: '#2f6f4f' }],
      items: [
        transaction({ id: 1, zweck: 'target-row', umsatztyp_id: null }),
        transaction({ id: 2, zweck: 'other-row', umsatztyp_id: null }),
      ],
    });

    const search = root.querySelector<HTMLInputElement>('#filter-search');
    if (!search) throw new Error('search field not rendered');
    search.value = 'target-row';
    search.dispatchEvent(new Event('input'));
    await settle();
    expect(bodyRows().length).toBe(1);

    const row = bodyRows()[0];
    row.querySelector<HTMLButtonElement>('.category-picker__trigger')?.click();
    fixture.detectChanges();
    const option = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.category-picker__option'),
    ).find((o) => o.textContent?.includes('Groceries'));
    if (!option) throw new Error('category option not rendered');
    option.click();
    fixture.detectChanges();

    const req = httpMock.expectOne('/api/transactions/1');
    req.flush(null, { status: 204, statusText: 'No Content' });
    await settle();

    // Still filtered to the one row, and its rendered cell — not just component state — now
    // shows the new category.
    expect(bodyRows().length).toBe(1);
    expect(cellText(bodyRows()[0], COL.category)).toContain('Groceries');
  });

  it('keeps zebra striping enabled for greenbar', async () => {
    await load({ items: [transaction()] });

    const table = root.querySelector('.data-table');
    expect(table?.classList).toContain('p-datatable-striped');
  });
});
