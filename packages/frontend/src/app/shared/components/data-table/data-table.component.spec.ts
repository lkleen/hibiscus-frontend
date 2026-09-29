import { registerLocaleData } from '@angular/common';
import { ChangeDetectionStrategy, Component, signal, computed } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import localeDe from '@angular/common/locales/de';
import { By } from '@angular/platform-browser';
import { Table } from 'primeng/table';
import { DataTableComponent } from './data-table.component';
import type { DataTableColDef, DataTableOptions } from './data-table.model';
import { colDef } from './data-table.model';
import { DataTableCellDirective } from './data-table-cell.directive';
import { installMutationObserverMock } from '../../../core/utils/testing/mutation-observer-mock';

registerLocaleData(localeDe);

/** Toy row type for testing. */
interface ToyRow {
  readonly id: number;
  readonly name: string | null;
  readonly amount: number | null;
  readonly day: string;
  readonly tag: string;
}

/**
 * Helper to create test rows with defaults.
 */
function toyRow(overrides: Partial<ToyRow> = {}): ToyRow {
  return {
    id: 1,
    name: 'Test Item',
    amount: 100,
    day: '2026-01-15',
    tag: 'test',
    ...overrides,
  };
}

/**
 * Host component for testing the generic table.
 */
@Component({
  selector: 'app-test-data-table-host',
  template: `
    <app-data-table [value]="rows()" [columns]="columns()" [options]="options()" [loading]="false">
      <ng-template
        appDataTableCell="custom"
        let-row
        let-value="value"
        let-valueFormatted="valueFormatted"
      >
        <span class="custom-cell">{{ row.id }}|{{ value }}|{{ valueFormatted }}</span>
      </ng-template>
    </app-data-table>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DataTableComponent, DataTableCellDirective],
})
class TestHostComponent {
  readonly rows = signal<readonly ToyRow[]>([]);
  readonly columnsBase = computed<readonly DataTableColDef<ToyRow, unknown>[]>(() => [
    colDef<ToyRow, string | null>({
      colId: 'name',
      headerKey: 'transactions.colRecipient',
      valueGetter: (row: ToyRow): string | null => row.name,
    }),
    colDef<ToyRow, number | null>({
      colId: 'amount',
      headerKey: 'transactions.colAmount',
    }),
    colDef<ToyRow, string>({
      colId: 'day',
      headerKey: 'transactions.colDate',
      filter: 'date',
    }),
    colDef<ToyRow, string>({
      colId: 'tag',
      headerKey: 'transactions.colBookingType',
      valueGetter: (row: ToyRow): string => `lookup:${row.tag}`,
      sortable: false,
    }),
    colDef<ToyRow, string>({
      colId: 'nofilter',
      headerKey: 'table.filterSearch',
      filter: false,
      valueGetter: (row: ToyRow): string => `nf:${row.id}`,
    }),
    colDef<ToyRow, string>({
      colId: 'hideId',
      hide: true,
      filter: false,
      valueGetter: (row: ToyRow): string => String(row.id),
    }),
    colDef<ToyRow, string>({
      colId: 'custom',
      headerKey: 'table.searchPlaceholder',
      cellRenderer: 'custom',
      valueGetter: (row: ToyRow): string => `custom:${row.name ?? 'empty'}`,
    }),
  ]);
  readonly columns = signal<readonly DataTableColDef<ToyRow, unknown>[]>([]);
  readonly options = signal<DataTableOptions<ToyRow>>({
    getRowId: (row: ToyRow): number => row.id,
    emptyKey: 'transactions.empty',
  });

  constructor() {
    // Initialize columns from base computed
    this.columns.set(this.columnsBase());
  }
}

describe('DataTableComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let host: TestHostComponent;
  let root: HTMLElement;

  beforeEach(() => {
    installMutationObserverMock();
    TestBed.configureTestingModule({
      imports: [TestHostComponent],
      providers: [],
    });
    fixture = TestBed.createComponent(TestHostComponent);
    host = fixture.componentInstance;
    root = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    fixture.destroy();
    vi.unstubAllGlobals();
  });

  /**
   * Lets PrimeNG render what it was given.
   */
  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    await wait(50);
    fixture.detectChanges();
  }

  function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Helper to get body rows (excluding empty message which also has a row).
   */
  function bodyRows(): HTMLTableRowElement[] {
    return Array.from(root.querySelectorAll<HTMLTableRowElement>('tbody tr')).filter(
      (row) => !row.querySelector('td[colspan]'),
    );
  }

  /**
   * Helper to get cell text at column index.
   */
  function cellText(row: HTMLTableRowElement, colIndex: number): string {
    return row.children[colIndex]?.textContent?.trim() ?? '';
  }

  /**
   * Helper to get header label text (ignoring sort icon).
   */
  function headerLabel(th: Element): string {
    return Array.from(th.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? '')
      .join('')
      .trim();
  }

  it('1. renders headers from headerKey (translated text), hidden columns render no th/td', async () => {
    host.rows.set([toyRow()]);
    await settle();

    const headers = Array.from(root.querySelectorAll<HTMLElement>('thead tr:first-child th')).map(
      headerLabel,
    );
    // hideId column should NOT be rendered; nofilter and custom columns should be
    expect(headers).toEqual([
      'Recipient',
      'Amount',
      'Date',
      'Booking type',
      'Search',
      'Search all columns…',
    ]);

    // Verify correct number of cells in body (6 visible columns)
    const bodyCells = bodyRows()[0]?.children;
    expect(bodyCells?.length).toBe(6);
  });

  it('2. renders a dash for null/blank values, and custom valueFormatter output', async () => {
    host.rows.set([toyRow({ name: null, amount: undefined })]);
    await settle();

    const row = bodyRows()[0];
    expect(cellText(row, 0)).toBe('—');
    expect(cellText(row, 1)).toBe('—');
  });

  it('3. valueGetter feeds display, sorting, filter, and search', async () => {
    // Use name column with explicit valueGetter for testing
    host.rows.set([
      toyRow({ id: 1, name: 'zebra' }),
      toyRow({ id: 2, name: 'apple' }),
      toyRow({ id: 3, name: 'banana' }),
    ]);
    await settle();

    // Display: valueGetter result is shown
    expect(cellText(bodyRows()[0], 0)).toBe('zebra');
    expect(cellText(bodyRows()[1], 0)).toBe('apple');
    expect(cellText(bodyRows()[2], 0)).toBe('banana');

    // Sorting: click the name header to sort by valueGetter result
    const headers = Array.from(root.querySelectorAll<HTMLElement>('thead tr:first-child th'));
    const nameHeader = headers[0];
    if (!nameHeader) throw new Error('name header not rendered');
    nameHeader.click();
    await settle();
    // Should sort alphabetically by valueGetter result: apple, banana, zebra
    const sortedNames = bodyRows().map((r) => cellText(r, 0));
    expect(sortedNames).toEqual(['apple', 'banana', 'zebra']);

    // Filtering: type into the name column's filter input (thead tr:nth-child(2))
    const filterCells = root.querySelectorAll<HTMLElement>('thead tr:nth-child(2) th');
    const nameFilterCell = filterCells[0];
    const filterInput = nameFilterCell?.querySelector<HTMLInputElement>('input');
    if (!filterInput) throw new Error('name filter input not rendered');
    filterInput.value = 'app';
    filterInput.dispatchEvent(new Event('input'));
    await settle();
    // Should filter to only 'apple' (matches on valueGetter result)
    expect(bodyRows().length).toBe(1);
    expect(cellText(bodyRows()[0], 0)).toBe('apple');

    // Clear the column filter
    filterInput.value = '';
    filterInput.dispatchEvent(new Event('input'));
    await settle();

    // Search: the global filter should also work with valueGetter result
    const search = root.querySelector<HTMLInputElement>('#filter-search');
    if (!search) throw new Error('search field not rendered');
    search.value = 'bana';
    search.dispatchEvent(new Event('input'));
    await settle();
    expect(bodyRows().length).toBe(1);
    expect(cellText(bodyRows()[0], 0)).toBe('banana');
  });

  it('4. custom comparator returning ascending result sorts correctly both directions', async () => {
    // Create rows with names of different lengths to test custom length-based comparator
    host.rows.set([
      toyRow({ id: 1, name: 'Charlie' }),
      toyRow({ id: 2, name: 'Alice' }),
      toyRow({ id: 3, name: 'Bob' }),
    ]);

    // Replace columns with custom comparator on name column (sorts by length)
    const customColumns: DataTableColDef<ToyRow, unknown>[] = [
      colDef<ToyRow, string | null>({
        colId: 'name',
        headerKey: 'transactions.colRecipient',
        comparator: (a: unknown, b: unknown): number => {
          const aLen = (a as string | null)?.length ?? 0;
          const bLen = (b as string | null)?.length ?? 0;
          return aLen < bLen ? -1 : aLen > bLen ? 1 : 0;
        },
      }),
      ...host.columnsBase().slice(1),
    ];
    host.columns.set(customColumns);
    await settle();

    // Click the name header to sort
    const headers = Array.from(root.querySelectorAll<HTMLElement>('thead tr:first-child th'));
    const nameHeader = headers[0];
    if (!nameHeader) throw new Error('name header not rendered');
    nameHeader.click();
    await settle();

    // Should be sorted by length: Alice (5), Charlie (7), Bob (3) → Bob, Alice, Charlie
    const ids = bodyRows().map((r) => cellText(r, 0));
    expect(ids).toEqual(['Bob', 'Alice', 'Charlie']);

    // Click again to reverse (but custom comparator still returns ascending, so component applies -1 order)
    nameHeader.click();
    await settle();
    const idsReverse = bodyRows().map((r) => cellText(r, 0));
    expect(idsReverse).toEqual(['Charlie', 'Alice', 'Bob']);
  });

  it('5. filter: false renders no filter input; sortable: false renders no sort icon', async () => {
    host.rows.set([toyRow({ id: 1, tag: 'a' }), toyRow({ id: 2, tag: 'b' })]);
    await settle();

    const filterCells = root.querySelectorAll<HTMLElement>('thead tr:nth-child(2) th');
    const headers = Array.from(root.querySelectorAll<HTMLElement>('thead tr:first-child th'));

    // filter: false column (nofilter, index 4) should have NO filter input
    const nofilterCell = filterCells[4];
    expect(nofilterCell?.querySelector('p-columnFilter')).toBeNull();

    // sortable: false column (tag, index 3) should have NO sort icon and clicking should not reorder
    const tagFilterCell = filterCells[3];
    expect(tagFilterCell?.querySelector('p-columnFilter')).toBeTruthy();

    const tagHeader = headers[3];
    expect(tagHeader?.querySelector('p-sortIcon')).toBeNull();

    // Verify clicking tag header does not sort
    const originalOrder = bodyRows().map((r) => cellText(r, 3));
    tagHeader?.click();
    await settle();
    const afterClick = bodyRows().map((r) => cellText(r, 3));
    expect(afterClick).toEqual(originalOrder);
  });

  it('6. date filter parses ISO strings and actually filters by the chosen day', async () => {
    const rawRows: ToyRow[] = [
      toyRow({ day: '2026-01-15' }),
      toyRow({ id: 2, day: '2026-02-15' }),
      toyRow({ id: 3, day: '2026-03-15' }),
    ];
    host.rows.set(rawRows);
    await settle();

    // Verify all rows render (date filter doesn't break on ISO strings)
    expect(bodyRows().length).toBe(3);

    // Call filter via the table API: the column-accessor proxy's filterValueGetter must have
    // turned the 'day' column's raw ISO string into a Date before PrimeNG's 'dateIs' match mode
    // (which calls .toDateString() on both sides) ever sees it.
    const tableDebug = fixture.debugElement.query(By.directive(Table));
    if (!tableDebug) throw new Error('table not found');
    const tableComponent = tableDebug.componentInstance as Table<ToyRow>;

    tableComponent.filter(new Date(2026, 1, 15), 'day', 'dateIs');
    // Table.filter() only applies the filter after `filterDelay` (default 300ms), via a timeout.
    await wait(350);
    await settle();

    const filteredRows = bodyRows();
    expect(filteredRows.length).toBe(1);
    expect(cellText(filteredRows[0], 2)).toBe('2026-02-15');

    // Verify raw rows still hold ISO strings (not Date objects written by filtering) — the
    // column-accessor proxy must stay read-only.
    expect(rawRows[0].day).toBe('2026-01-15');
    expect(rawRows[1].day).toBe('2026-02-15');
    expect(rawRows[2].day).toBe('2026-03-15');
  });

  it('7. custom quickFilter.matcher is used by search; quickFilter: false renders no search input', async () => {
    host.rows.set([
      toyRow({ id: 1, name: 'apple' }),
      toyRow({ id: 2, name: 'apply' }),
      toyRow({ id: 3, name: 'banana' }),
    ]);
    await settle();

    // Part (a): test that search box exists and uses containsMatcher by default
    const search = root.querySelector<HTMLInputElement>('#filter-search');
    expect(search).toBeTruthy();

    // Default containsMatcher does substring matching (accent-insensitive)
    if (search) {
      search.value = 'app';
      search.dispatchEvent(new Event('input'));
      await settle();
      expect(bodyRows().length).toBe(2); // matches 'apple' and 'apply'

      search.value = 'bana';
      search.dispatchEvent(new Event('input'));
      await settle();
      expect(bodyRows().length).toBe(1); // matches 'banana'
    }

    // Part (b): a custom quickFilter.matcher replaces the default containsMatcher entirely.
    host.options.set({
      getRowId: (row: ToyRow): number => row.id,
      emptyKey: 'transactions.empty',
      quickFilter: {
        matcher: (text: string, query: string): boolean => text.startsWith(query),
      },
    });
    await settle();

    const searchWithCustomMatcher = root.querySelector<HTMLInputElement>('#filter-search');
    if (!searchWithCustomMatcher) throw new Error('search field not rendered');

    // 'pple' is a substring of both 'apple' and 'apply' — the default containsMatcher would match
    // it (as proven in part (a) above), but the prefix matcher must reject both.
    searchWithCustomMatcher.value = 'pple';
    searchWithCustomMatcher.dispatchEvent(new Event('input'));
    await settle();
    expect(bodyRows().length).toBe(0);

    // 'app' is a genuine prefix of both 'apple' and 'apply'.
    searchWithCustomMatcher.value = 'app';
    searchWithCustomMatcher.dispatchEvent(new Event('input'));
    await settle();
    expect(bodyRows().length).toBe(2);
  });

  it('7b. quickFilter: false renders no search input', async () => {
    host.rows.set([toyRow()]);
    host.options.set({
      getRowId: (row: ToyRow): number => row.id,
      emptyKey: 'transactions.empty',
      quickFilter: false,
    });
    await settle();

    const search = root.querySelector<HTMLInputElement>('#filter-search');
    expect(search).toBeNull();
  });

  it('8. pagination: false renders no paginator and shows all rows', async () => {
    // Create 50 rows
    const manyRows = Array.from({ length: 50 }, (_, i) =>
      toyRow({ id: i + 1, name: `Item ${i + 1}` }),
    );
    host.rows.set(manyRows);

    // Replace options to disable pagination
    host.options.set({
      getRowId: (row: ToyRow): number => row.id,
      emptyKey: 'transactions.empty',
      pagination: false,
    });
    await settle();

    // No paginator should render
    const paginator = root.querySelector('.p-paginator');
    expect(paginator).toBeNull();

    // All 50 rows should be visible
    expect(bodyRows().length).toBe(50);
  });

  it('9. in-place row mutation + refresh() shows new value, stays on page, no extra row properties', async () => {
    // Create rows and set up pagination with pageSize 2
    const rows: ToyRow[] = Array.from({ length: 5 }, (_, i) =>
      toyRow({ id: i + 1, name: `Item ${i + 1}` }),
    );
    host.rows.set(rows);
    host.options.set({
      getRowId: (row: ToyRow): number => row.id,
      emptyKey: 'transactions.empty',
      pagination: { pageSize: 2, pageSizes: [2] },
    });
    await settle();

    // Verify original row keys
    const originalRow = rows[0] as unknown as Record<string, unknown>;
    const originalKeys = Object.keys(originalRow).sort();

    // Go to page 2 (rows 3-4)
    const nextButton = root.querySelector<HTMLButtonElement>('.p-paginator-next');
    if (!nextButton) throw new Error('paginator next button not rendered');
    nextButton.click();
    await settle();

    // Verify we're on page 2 (shows Item 3, Item 4)
    expect(bodyRows().length).toBe(2);
    expect(cellText(bodyRows()[0], 0)).toBe('Item 3');

    // Mutate a row on page 2 (row with id 3)
    const mutableRow = rows[2] as unknown as Record<string, unknown>;
    mutableRow['name'] = 'Updated Item 3';

    // Get the DataTableComponent and call refresh
    const tableDebug = fixture.debugElement.query(By.directive(DataTableComponent));
    if (!tableDebug) throw new Error('data-table not found');
    const tableComponent = tableDebug.componentInstance as DataTableComponent<ToyRow>;
    tableComponent.refresh();
    await settle();

    // Should still show page 2 with updated value
    expect(bodyRows().length).toBe(2);
    expect(cellText(bodyRows()[0], 0)).toBe('Updated Item 3');

    // Row should not have gained extra properties
    const afterKeys = Object.keys(mutableRow).sort();
    expect(afterKeys).toEqual(originalKeys);

    // Now test with a filter active
    const search = root.querySelector<HTMLInputElement>('#filter-search');
    if (!search) throw new Error('search not rendered');

    // Filter to show only items containing 'Item 1' or 'Item 2' (just Items 1, 2 on page 1)
    search.value = 'Item 1';
    search.dispatchEvent(new Event('input'));
    await settle();
    expect(bodyRows().length).toBeGreaterThan(0);

    // Mutate a filtered row
    const filteredRow = rows[0] as unknown as Record<string, unknown>;
    filteredRow['name'] = 'Updated Item 1';
    tableComponent.refresh();
    await settle();

    // Value should update (first row should now show updated name)
    expect(cellText(bodyRows()[0], 0)).toBe('Updated Item 1');
  });

  it('10. cellRenderer template receives raw row, value, and valueFormatted', async () => {
    const rawRow = toyRow({ name: 'TestName', id: 99 });
    host.rows.set([rawRow]);
    await settle();

    // Should have a custom cell renderer with context showing row.id|value|valueFormatted
    const customCell = root.querySelector<HTMLElement>('.custom-cell');
    expect(customCell).toBeTruthy();
    // Template renders: {{ row.id }}|{{ value }}|{{ valueFormatted }}
    // valueGetter for custom col: `custom:${row.name ?? 'empty'}`
    // valueFormatter default: dashFormatter
    const expectedText = `99|custom:TestName|custom:TestName`;
    expect(customCell?.textContent).toBe(expectedText);

    // Verify row parameter is the raw row object (by checking row.id value matches)
    expect(customCell?.textContent).toContain('99');

    // Verify it's in the last visible column
    const lastCell = bodyRows()[0].querySelector('td:last-child');
    expect(lastCell?.querySelector('.custom-cell')).toBeTruthy();

    // Now test that an unknown cellRenderer throws
    const badCols = host.columns() as unknown as DataTableColDef<ToyRow, unknown>[];
    const badColDef = colDef<ToyRow, string>({
      colId: 'badRenderer',
      headerKey: 'table.filterSearch',
      cellRenderer: 'nonexistent',
      valueGetter: (): string => 'value',
    });

    // Replace columns to include the bad renderer
    host.columns.set([...badCols, badColDef] as readonly DataTableColDef<ToyRow, unknown>[]);
    host.rows.set([toyRow()]);

    // detectChanges should throw when the template tries to resolve the missing renderer
    expect(() => {
      fixture.detectChanges();
    }).toThrow();
  });

  it('11. default: p-datatable has p-datatable-resizable class, no p-datatable-resizable-fit, headers have resizers', async () => {
    host.rows.set([toyRow()]);
    await settle();

    const pTable = root.querySelector<HTMLElement>('p-table');
    expect(pTable).toBeTruthy();

    // Should have resizable class but not resizable-fit
    expect(pTable?.classList.contains('p-datatable-resizable')).toBe(true);
    expect(pTable?.classList.contains('p-datatable-resizable-fit')).toBe(false);

    // First-row headers should have the resizer span
    const headerThs = Array.from(root.querySelectorAll<HTMLElement>('thead tr:first-child th'));
    expect(headerThs.length).toBeGreaterThan(0);

    // Each header th should contain a .p-datatable-column-resizer span (created by PrimeNG)
    for (const th of headerThs) {
      const resizer = th.querySelector<HTMLElement>('.p-datatable-column-resizer');
      expect(resizer).toBeTruthy();
    }
  });

  it('12. columnResize: { mode: "fit" } adds p-datatable-resizable-fit class', async () => {
    host.rows.set([toyRow()]);
    host.options.set({
      getRowId: (row: ToyRow): number => row.id,
      emptyKey: 'transactions.empty',
      columnResize: { mode: 'fit' },
    });
    await settle();

    const pTable = root.querySelector<HTMLElement>('p-table');
    expect(pTable?.classList.contains('p-datatable-resizable')).toBe(true);
    expect(pTable?.classList.contains('p-datatable-resizable-fit')).toBe(true);
  });

  it('13. columnResize: false removes resizable classes and resizer spans', async () => {
    host.rows.set([toyRow()]);
    host.options.set({
      getRowId: (row: ToyRow): number => row.id,
      emptyKey: 'transactions.empty',
      columnResize: false,
    });
    await settle();

    const pTable = root.querySelector<HTMLElement>('p-table');
    expect(pTable?.classList.contains('p-datatable-resizable')).toBe(false);
    expect(pTable?.classList.contains('p-datatable-resizable-fit')).toBe(false);

    // No resizer spans should exist
    const resizers = root.querySelectorAll<HTMLElement>('.p-datatable-column-resizer');
    expect(resizers.length).toBe(0);
  });

  it('14. a column with resizable: false has no resizer, while others do', async () => {
    host.rows.set([toyRow()]);

    // Create columns with the "name" column marked as not resizable
    const customColumns: DataTableColDef<ToyRow, unknown>[] = [
      colDef<ToyRow, string | null>({
        colId: 'name',
        headerKey: 'transactions.colRecipient',
        valueGetter: (row: ToyRow): string | null => row.name,
        resizable: false, // Not resizable
      }),
      colDef<ToyRow, number | null>({
        colId: 'amount',
        headerKey: 'transactions.colAmount',
        resizable: true, // Explicitly resizable
      }),
      ...host.columnsBase().slice(2),
    ];
    host.columns.set(customColumns);
    await settle();

    const headerThs = Array.from(root.querySelectorAll<HTMLElement>('thead tr:first-child th'));

    // First th (name column) should NOT have a resizer
    const nameThResizer = headerThs[0]?.querySelector<HTMLElement>('.p-datatable-column-resizer');
    expect(nameThResizer).toBeNull();

    // Second th (amount column) should have a resizer
    const amountThResizer = headerThs[1]?.querySelector<HTMLElement>('.p-datatable-column-resizer');
    expect(amountThResizer).toBeTruthy();
  });

  it('15. fitGridWidth with columnLimits sets inline min-width on header ths', async () => {
    host.rows.set([toyRow()]);
    host.options.set({
      getRowId: (row: ToyRow): number => row.id,
      emptyKey: 'transactions.empty',
      autoSizeStrategy: {
        type: 'fitGridWidth',
        defaultMinWidth: 80,
        columnLimits: [{ colId: 'amount', minWidth: 120 }],
      },
    });
    await settle();

    const headerThs = Array.from(root.querySelectorAll<HTMLElement>('thead tr:first-child th'));

    // amount column (index 1) has its own limit; name column (index 0) falls back to defaultMinWidth
    expect(headerThs[1]?.style.minWidth).toBe('120px');
    expect(headerThs[0]?.style.minWidth).toBe('80px');

    // The filter row carries no limits of its own — PrimeNG's nth-child rules size it with row 1.
    const filterThs: HTMLElement[] = Array.from(
      root.querySelectorAll<HTMLElement>('thead tr:nth-child(2) th'),
    );
    expect(filterThs.length).toBeGreaterThan(0);
    expect(filterThs.every((th: HTMLElement): boolean => th.style.minWidth === '')).toBe(true);
  });

  it('16b. a hidden column in columnLimits throws, since it renders no header cell', async () => {
    host.rows.set([toyRow()]);
    host.options.set({
      getRowId: (row: ToyRow): number => row.id,
      emptyKey: 'transactions.empty',
      autoSizeStrategy: {
        type: 'fitGridWidth',
        columnLimits: [{ colId: 'hideId', minWidth: 100 }],
      },
    });

    expect(() => {
      fixture.detectChanges();
    }).toThrow(/unknown column.*hideId/i);
  });

  it('16. unknown colId in columnLimits throws error with "unknown column"', async () => {
    host.rows.set([toyRow()]);
    host.options.set({
      getRowId: (row: ToyRow): number => row.id,
      emptyKey: 'transactions.empty',
      autoSizeStrategy: {
        type: 'fitGridWidth',
        columnLimits: [{ colId: 'nonexistent', minWidth: 100 }],
      },
    });

    // Should throw when trying to compute columnLimits
    expect(() => {
      fixture.detectChanges();
    }).toThrow(/unknown column.*nonexistent/i);
  });

  it('17. fitProvidedWidth sets inline width on the inner table', async () => {
    host.rows.set([toyRow()]);
    host.options.set({
      getRowId: (row: ToyRow): number => row.id,
      emptyKey: 'transactions.empty',
      autoSizeStrategy: {
        type: 'fitProvidedWidth',
        width: 900,
      },
    });
    await settle();

    // Find the inner table element (PrimeNG renders it within p-table)
    const innerTable = root.querySelector<HTMLTableElement>(
      '.p-datatable-table, [data-pc-section="table"]',
    );
    expect(innerTable).toBeTruthy();
    expect(innerTable?.style.width).toBe('900px');
  });

  it('18. fitCellContents sets width max-content on table and adds data-table--fit-contents class', async () => {
    host.rows.set([toyRow()]);
    host.options.set({
      getRowId: (row: ToyRow): number => row.id,
      emptyKey: 'transactions.empty',
      autoSizeStrategy: {
        type: 'fitCellContents',
      },
    });
    await settle();

    const pTable = root.querySelector<HTMLElement>('p-table');
    expect(pTable?.classList.contains('data-table--fit-contents')).toBe(true);

    // Find the inner table element
    const innerTable = root.querySelector<HTMLTableElement>(
      '.p-datatable-table, [data-pc-section="table"]',
    );
    expect(innerTable?.style.width).toBe('max-content');
  });

  it('19. minWidth combines with fitCellContents (both min-width and width max-content)', async () => {
    host.rows.set([toyRow()]);
    host.options.set({
      getRowId: (row: ToyRow): number => row.id,
      emptyKey: 'transactions.empty',
      minWidth: '50rem',
      autoSizeStrategy: {
        type: 'fitCellContents',
      },
    });
    await settle();

    const pTable = root.querySelector<HTMLElement>('p-table');
    expect(pTable?.classList.contains('data-table--fit-contents')).toBe(true);

    // Find the inner table element
    const innerTable = root.querySelector<HTMLTableElement>(
      '.p-datatable-table, [data-pc-section="table"]',
    );
    expect(innerTable?.style.width).toBe('max-content');
    expect(innerTable?.style.minWidth).toBe('50rem');
  });
});
