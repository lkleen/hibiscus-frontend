import { registerLocaleData } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import localeDe from '@angular/common/locales/de';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import { LocaleService } from '../../../core/services/locale.service';
import { categoryRow } from '../../../core/utils/testing/category-row-fixture';
import { installMutationObserverMock } from '../../../core/utils/testing/mutation-observer-mock';
import { TransactionDialogs } from '../transaction-dialogs';
import { account, transaction, transactionsResponse } from '../testing/transaction-fixture';
import { TransactionsStore } from '../transactions.store';
import { TransactionsListComponent } from './transactions-list.component';

registerLocaleData(localeDe);

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Loaded {
  accounts?: AccountRow[];
  items?: TransactionRow[];
  categories?: CategoryRow[];
}

// Column order in the `#body` template (after the leading checkbox cell) — used to pick a cell out
// of a row by index rather than by a DOM hook the implementation doesn't have.
const COL = {
  valuta: 1,
  betrag: 2,
  saldo: 3,
  zweck: 4,
  datum: 7,
} as const;

describe('TransactionsListComponent', () => {
  let fixture: ComponentFixture<TransactionsListComponent>;
  let httpMock: HttpTestingController;
  let root: HTMLElement;

  beforeEach(() => {
    installMutationObserverMock();
    TestBed.configureTestingModule({
      imports: [TransactionsListComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        TransactionsStore,
        TransactionDialogs,
      ],
    });
    fixture = TestBed.createComponent(TransactionsListComponent);
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

  /** Starts the component, answers its requests and lets the table render. */
  async function load({ accounts = [], items = [], categories = [] }: Loaded = {}): Promise<void> {
    fixture.detectChanges();
    httpMock.expectOne('/api/accounts').flush(accounts);
    httpMock.expectOne('/api/transactions').flush(transactionsResponse(items));
    httpMock.expectOne('/api/categories').flush(categories);
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

  it('renders the transactions, with their account resolved', async () => {
    await load({
      accounts: [account({ id: 1, bezeichnung: 'Checking' })],
      items: [
        transaction({
          empfaenger_name: 'Supermarket',
          zweck: 'Direct debit',
          zweck3: 'Weekly shop',
        }),
      ],
    });

    expect(bodyRows().length).toBe(1);
    const text = root.textContent ?? '';
    expect(text).toContain('Supermarket');
    expect(text).toContain('Direct debit');
    expect(text).toContain('Weekly shop');
    expect(text).toContain('Checking');
    expect(text).toContain('2026-09-01');
  });

  it('shows the stored category as its path, and the comment and flags as stored', async () => {
    await load({
      categories: [
        categoryRow({ id: 6, name: 'Living', parent_id: null }),
        categoryRow({ id: 7, name: 'Groceries', parent_id: 6 }),
      ],
      items: [transaction({ umsatztyp_id: 7, kommentar: 'Checked', flags: 2 })],
    });

    const row: HTMLTableRowElement = bodyRows()[0];
    const cells: string[] = Array.from(row.querySelectorAll('td')).map(
      (cell: HTMLTableCellElement) => cell.textContent?.trim() ?? '',
    );
    expect(cells.slice(-3)).toEqual(['Living / Groceries', 'Checked', '2']);
  });

  it('shows a dash in the columns a transaction has no value for', async () => {
    await load({ items: [transaction({ empfaenger_name: null, zweck: '', zweck3: null })] });

    const dashes = Array.from(root.querySelectorAll('tbody td')).filter(
      (cell) => cell.textContent?.trim() === '—',
    );
    // The four account columns (account unknown here) and every text column without a value fall
    // back to the dash: recipient name/account/bank, the three purposes, booking type, transaction
    // code, end-to-end id, balance, category, comment and flags.
    expect(dashes.length).toBe(17);
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
    expect(headerCells.length).toBe(21);
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
    expect(text).toContain('-1.234,50');
    const headers = Array.from(root.querySelectorAll('thead tr:first-child th')).map(headerLabel);
    expect(headers).toEqual([
      '',
      'Valuta',
      'Betrag',
      'Saldo',
      'Verwendungszweck 1',
      'Verwendungszweck 2',
      'Verwendungszweck 3',
      'Datum',
      'Kontoinhaber',
      'Konto-BIC',
      'Kontonummer',
      'Kontobezeichnung',
      'Empfänger',
      'Empfängerkonto',
      'Empfänger-BIC/BLZ',
      'Buchungsart',
      'Geschäftsvorfallcode',
      'Ende-zu-Ende-Referenz',
      'Kategorie',
      'Kommentar',
      'Flags',
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

  it('sorts the earliest value date first, ties broken by the oldest id', async () => {
    await load({
      items: [
        transaction({ id: 1, valuta: '2026-03-01', zweck: '1' }),
        transaction({ id: 2, valuta: '2026-01-01', zweck: '2' }),
        transaction({ id: 3, valuta: '2026-03-01', zweck: '3' }),
      ],
    });

    expect(displayedIds()).toEqual([2, 1, 3]);
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
      `thead tr:nth-child(2) th:nth-child(${COL.datum + 1}) input`,
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

  it('right-click then Edit saves a new comment and category, and the list repaints in place', async () => {
    await load({
      accounts: [account({ id: 1 })],
      items: [transaction({ id: 5, zweck: 'Direct debit', kommentar: 'Old note' })],
      categories: [categoryRow({ id: 9, name: 'Groceries' })],
    });

    const cell: Element | undefined = bodyRows()[0].children[COL.zweck];
    cell.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }),
    );
    await settle();

    const labels: string[] = Array.from(
      document.querySelectorAll<HTMLElement>('[cdkMenuItem]'),
    ).map((el: HTMLElement) => el.textContent?.trim() ?? '');
    expect(labels).toEqual(['View', 'Edit', 'Assign']);
    expect(document.querySelectorAll<HTMLElement>('[cdkMenuItem]')[2].title).toBe(
      'Assign this transaction to a category, or remove its category',
    );
    document.querySelectorAll<HTMLElement>('[cdkMenuItem]')[1].click();
    await settle();

    const dialog: HTMLElement | null = document.querySelector('app-transaction-edit-dialog');
    if (!dialog) throw new Error('edit dialog not rendered');
    const textarea: HTMLTextAreaElement | null = dialog.querySelector('textarea');
    if (!textarea) throw new Error('textarea not rendered');
    textarea.value = 'New note';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    const groceries: HTMLElement | undefined = Array.from(
      dialog.querySelectorAll<HTMLElement>('tbody tr'),
    ).find((el: HTMLElement) => el.textContent?.trim() === 'Groceries');
    if (!groceries) throw new Error('category row not rendered');
    groceries.click();
    await settle();

    const save: HTMLButtonElement | undefined = Array.from(
      dialog.querySelectorAll<HTMLButtonElement>('button'),
    ).find((el: HTMLButtonElement) => el.textContent?.trim() === 'Save');
    if (!save) throw new Error('Save button not rendered');
    save.click();
    httpMock
      .expectOne({ method: 'PATCH', url: '/api/transactions/5' })
      .flush(null, { status: 204, statusText: 'No Content' });
    await settle();

    expect(document.querySelector('app-transaction-edit-dialog')).toBeNull();
    expect(root.textContent).toContain('New note');
    expect(root.textContent).not.toContain('Old note');
    expect(root.textContent).toContain('Groceries');
  });

  it('right-click then View lists the transaction columns in the details dialog', async () => {
    await load({
      accounts: [account({ id: 1, name: 'Jane Doe' })],
      items: [transaction({ zweck: 'Direct debit', empfaenger_name: 'Supermarket' })],
    });

    const cell: HTMLTableCellElement | undefined = bodyRows()[0].children[COL.zweck] as
      HTMLTableCellElement | undefined;
    if (!cell) throw new Error('purpose cell not rendered');
    cell.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }),
    );
    await settle();

    const showItem: HTMLElement | undefined = Array.from(
      document.querySelectorAll<HTMLElement>('[cdkMenuItem]'),
    ).find((el: HTMLElement) => el.textContent?.trim() === 'View');
    if (!showItem) throw new Error('View menu item not rendered');
    showItem.click();
    await settle();

    const dialog: HTMLElement | null = document.querySelector('app-data-table-row-details');
    if (!dialog) throw new Error('details dialog not rendered');
    const labels: string[] = Array.from(dialog.querySelectorAll('.data-table-details__label')).map(
      (el: Element) => el.textContent?.trim() ?? '',
    );
    const values: string[] = Array.from(dialog.querySelectorAll('.data-table-details__value')).map(
      (el: Element) => el.textContent?.trim() ?? '',
    );
    expect(labels.length).toBe(20);
    expect(labels).toContain('Account holder');
    expect(values).toContain('Direct debit');
    expect(values).toContain('Supermarket');
    expect(values).toContain('Jane Doe');

    const close: HTMLElement | null = dialog.querySelector<HTMLElement>(
      '.data-table-details__close',
    );
    if (!close) throw new Error('close button not rendered');
    close.click();
    await settle();
    expect(document.querySelectorAll('app-data-table-row-details').length).toBe(0);
  });

  describe('bulk assign', () => {
    const tx = (id: number): TransactionRow =>
      transaction({ id, zweck: `Tx ${id}`, umsatztyp_id: null, kommentar: `N${id}` });

    function boxes(): HTMLInputElement[] {
      return Array.from(root.querySelectorAll<HTMLInputElement>('tbody .data-table__checkbox'));
    }
    function isIdle(): boolean {
      const bar: Element | null = root.querySelector('app-transactions-selection-bar');
      if (!bar) throw new Error('selection bar not rendered');
      return bar.classList.contains('selection-bar--idle');
    }
    function menu(row: number): HTMLElement[] {
      bodyRows()[row].children[COL.zweck].dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
      );
      fixture.detectChanges();
      return Array.from(document.querySelectorAll<HTMLElement>('[cdkMenuItem]'));
    }
    function disabledFlags(items: HTMLElement[]): (string | null)[] {
      return items.map((el: HTMLElement) => el.getAttribute('aria-disabled'));
    }

    it('shows N selected with a Clear button while rows are ticked', async () => {
      await load({ items: [tx(1), tx(2)] });
      expect(isIdle()).toBe(true);
      boxes()[0].click();
      boxes()[1].click();
      await settle();
      expect(root.querySelector('.selection-bar__count')?.textContent).toContain('2 selected');
      const clear: HTMLButtonElement | undefined = Array.from(
        root.querySelectorAll<HTMLButtonElement>('.filters__action'),
      ).find((el: HTMLButtonElement) => el.textContent?.trim() === 'Clear selection');
      if (!clear) throw new Error('Clear button not rendered');
      clear.click();
      await settle();
      expect(isIdle()).toBe(true);
    });

    it('disables View and Edit on a selected row; Assign saves the selection and clears it', async () => {
      await load({
        items: [tx(1), tx(2)],
        categories: [categoryRow({ id: 4, name: 'Food' })],
      });
      boxes()[0].click();
      boxes()[1].click();
      await settle();
      const items: HTMLElement[] = menu(0);
      expect(disabledFlags(items)).toEqual(['true', 'true', null]);
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
      // The selection is only cleared once the save is confirmed.
      expect(isIdle()).toBe(false);
      request.flush(null, { status: 204, statusText: 'No Content' });
      await settle();
      expect(isIdle()).toBe(true);
    });

    it('a row outside the selection, or a single ticked row, keeps the single-row menu', async () => {
      await load({ items: [tx(1), tx(2), tx(3)] });
      boxes()[0].click();
      await settle();
      expect(disabledFlags(menu(0))).toEqual([null, null, null]);
      document.body.click();
      boxes()[1].click();
      await settle();
      expect(disabledFlags(menu(2))).toEqual([null, null, null]);
    });
  });

  it('keeps zebra striping enabled for greenbar', async () => {
    await load({ items: [transaction()] });

    const table = root.querySelector('.data-table');
    expect(table?.classList).toContain('p-datatable-striped');
  });
});
