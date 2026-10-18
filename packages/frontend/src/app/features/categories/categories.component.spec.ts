import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { MockInstance } from 'vitest';
import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import { installMutationObserverMock } from '../../core/utils/testing/mutation-observer-mock';
import { categoryRow } from '../../core/utils/testing/category-row-fixture';
import type {
  DataTableContextMenuParams,
  DataTableMenuItem,
  DataTableOptions,
} from '../../shared/components/data-table/data-table.model';
import { TableDensityService } from '../../core/services/table-density.service';
import type { TableDensity } from '@hibiscus-frontend/shared/contracts/user-settings';
import { account } from '../transactions/testing/transaction-fixture';
import { CategoriesComponent } from './categories.component';
import { CategoryDialogs } from './category-dialogs';
import { CategoriesStore } from './categories.store';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Column order in the rendered table (the hidden `id` column has no cell).
const COL = {
  name: 0,
  type: 2,
  isRegex: 4,
  color: 5,
  customColor: 6,
  flags: 8,
  account: 9,
} as const;

describe('CategoriesComponent', () => {
  let fixture: ComponentFixture<CategoriesComponent>;
  let httpMock: HttpTestingController;
  let root: HTMLElement;

  beforeEach(() => {
    installMutationObserverMock();
    TestBed.configureTestingModule({
      imports: [CategoriesComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(CategoriesComponent);
    httpMock = TestBed.inject(HttpTestingController);
    root = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    fixture.destroy();
    httpMock.verify();
    vi.unstubAllGlobals();
  });

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    await wait(50);
    fixture.detectChanges();
  }

  async function load(categories: CategoryRow[], accounts: AccountRow[] = []): Promise<void> {
    fixture.detectChanges();
    httpMock.expectOne('/api/accounts').flush(accounts);
    httpMock.expectOne('/api/categories').flush(categories);
    httpMock.expectOne('/api/transactions').flush({ columns: [], rows: [] });
    httpMock.expectOne('/api/settings/table-densities').flush({});
    await settle();
  }

  function bodyRows(): HTMLTableRowElement[] {
    return Array.from(root.querySelectorAll<HTMLTableRowElement>('tbody tr')).filter(
      (row) => !row.querySelector('td[colspan]'),
    );
  }

  function cellText(row: HTMLTableRowElement, col: number): string {
    return row.children[col]?.textContent?.trim() ?? '';
  }

  function rowByName(name: string): HTMLTableRowElement {
    const row = bodyRows().find((r) => cellText(r, COL.name) === name);
    if (!row) throw new Error(`row "${name}" not rendered`);
    return row;
  }

  it('renders the categories as a tree, children under their parent', async () => {
    await load([
      categoryRow({ id: 3, name: 'Bakery', parent_id: 1 }),
      categoryRow({ id: 2, name: 'Zoo' }),
      categoryRow({ id: 1, name: 'Food' }),
    ]);

    expect(bodyRows().map((r) => cellText(r, COL.name))).toEqual(['Food', 'Bakery', 'Zoo']);
    expect(
      rowByName('Food').querySelector('p-treetabletoggler, p-treeTableToggler'),
    ).not.toBeNull();
  });

  it('translates the type, showing NULL as any and an unknown number raw', async () => {
    await load([
      categoryRow({ id: 1, name: 'a', umsatztyp: 0 }),
      categoryRow({ id: 2, name: 'b', umsatztyp: 1 }),
      categoryRow({ id: 3, name: 'c', umsatztyp: 2 }),
      categoryRow({ id: 4, name: 'd', umsatztyp: null }),
      categoryRow({ id: 5, name: 'e', umsatztyp: 7 }),
    ]);

    expect(cellText(rowByName('a'), COL.type)).toBe('Expense');
    expect(cellText(rowByName('b'), COL.type)).toBe('Income');
    expect(cellText(rowByName('c'), COL.type)).toBe('Any');
    expect(cellText(rowByName('d'), COL.type)).toBe('Any');
    expect(cellText(rowByName('e'), COL.type)).toBe('7');
  });

  it('shows yes only for a boolean column that is exactly 1', async () => {
    await load([
      categoryRow({ id: 1, name: 'a', isregex: 1, customcolor: 1, color: '1,2,3' }),
      categoryRow({ id: 2, name: 'b', isregex: 2, customcolor: null }),
    ]);

    expect(cellText(rowByName('a'), COL.isRegex)).toBe('Yes');
    expect(cellText(rowByName('a'), COL.customColor)).toBe('Yes');
    expect(cellText(rowByName('b'), COL.isRegex)).toBe('No');
    expect(cellText(rowByName('b'), COL.customColor)).toBe('No');
  });

  it('shows the flags: bit 1 translated, other bits numeric, none as a dash', async () => {
    await load([
      categoryRow({ id: 1, name: 'a', flags: 1 }),
      categoryRow({ id: 2, name: 'b', flags: 5 }),
      categoryRow({ id: 3, name: 'c', flags: 4 }),
      categoryRow({ id: 4, name: 'd', flags: 0 }),
      categoryRow({ id: 5, name: 'e', flags: null }),
    ]);

    expect(cellText(rowByName('a'), COL.flags)).toBe('Skip in reports');
    expect(cellText(rowByName('b'), COL.flags)).toBe('Skip in reports, 4');
    expect(cellText(rowByName('c'), COL.flags)).toBe('4');
    expect(cellText(rowByName('d'), COL.flags)).toBe('—');
    expect(cellText(rowByName('e'), COL.flags)).toBe('—');
  });

  it('resolves the account to its label, falling back to the holder name; null is a dash', async () => {
    await load(
      [
        categoryRow({ id: 1, name: 'a', konto_id: 1 }),
        categoryRow({ id: 2, name: 'b', konto_id: 2 }),
        categoryRow({ id: 3, name: 'c', konto_id: null }),
      ],
      [
        account({ id: 1, bezeichnung: 'Checking' }),
        account({ id: 2, bezeichnung: null, name: 'Jane Doe' }),
      ],
    );

    expect(cellText(rowByName('a'), COL.account)).toBe('Checking');
    expect(cellText(rowByName('b'), COL.account)).toBe('Jane Doe');
    expect(cellText(rowByName('c'), COL.account)).toBe('—');
  });

  it('shows a colour swatch for "r,g,b" with customcolor 1, none with customcolor 0', async () => {
    await load([
      categoryRow({ id: 1, name: 'a', color: '10,20,30', customcolor: 1 }),
      categoryRow({ id: 2, name: 'b', color: '10,20,30', customcolor: 0 }),
    ]);

    const swatch: HTMLElement | null = rowByName('a').querySelector('.category-color-cell__swatch');
    expect(swatch?.style.backgroundColor).toBe('rgb(10 20 30)');
    expect(cellText(rowByName('a'), COL.color)).toBe('10,20,30');
    expect(rowByName('b').querySelector('.category-color-cell__swatch')).toBeNull();
    expect(cellText(rowByName('b'), COL.color)).toBe('—');
  });

  it('renders a ribbon with a Filter and a View tab', async () => {
    await load([categoryRow({ id: 1, name: 'Food' })]);

    const tabs: string[] = Array.from(root.querySelectorAll('.ribbon__tab')).map(
      (t) => t.textContent?.trim() ?? '',
    );
    expect(tabs.length).toBe(2);
  });

  it('filters the tree with the search field and shows the text as ribbon state', async () => {
    await load([categoryRow({ id: 1, name: 'Food' }), categoryRow({ id: 2, name: 'Zoo' })]);
    const input: HTMLInputElement = root.querySelector<HTMLInputElement>('#categories-search')!;

    input.value = 'zoo';
    input.dispatchEvent(new Event('input'));
    await settle();

    expect(bodyRows().map((r) => cellText(r, COL.name))).toEqual(['Zoo']);
    expect(root.querySelector('.ribbon__state')?.textContent).toContain('"zoo"');
    expect(root.querySelector('#filter-search')).toBeNull();
  });

  it('puts the expand/collapse buttons into the View band', async () => {
    await load([
      categoryRow({ id: 1, name: 'Food' }),
      categoryRow({ id: 2, name: 'Bakery', parent_id: 1 }),
    ]);

    const band: HTMLElement | null = root.querySelector('#categories-panel-view');
    expect(band?.querySelectorAll('button').length).toBeGreaterThanOrEqual(2);
  });

  it('applies the density from the service to the table', async () => {
    const densities: TableDensityService = TestBed.inject(TableDensityService);
    vi.spyOn(densities, 'densityFor').mockReturnValue(signal<TableDensity>('compact'));

    await load([categoryRow({ id: 1, name: 'Food' })]);

    expect(root.querySelector('app-data-table')?.className).toContain('table-density-compact');
  });

  it('shows an error when the categories cannot be loaded', async () => {
    fixture.detectChanges();
    httpMock.expectOne('/api/accounts').flush([]);
    httpMock.expectOne('/api/transactions').flush({ columns: [], rows: [] });
    httpMock.expectOne('/api/settings/table-densities').flush({});
    httpMock
      .expectOne('/api/categories')
      .flush('boom', { status: 500, statusText: 'Server Error' });
    await settle();

    expect(root.querySelector('.status-text--error')?.textContent).toContain(
      'Could not load categories.',
    );
  });

  it('offers only Edit in the row menu, which opens the category dialog for that row', async () => {
    await load([categoryRow({ id: 1, name: 'Food' })]);
    const options: DataTableOptions<CategoryRow> = fixture.componentInstance['options'];
    if (!options.getContextMenuItems) throw new Error('getContextMenuItems is not set');
    const dialogs: CategoryDialogs = fixture.debugElement.injector.get(CategoryDialogs);
    const store: CategoriesStore = fixture.debugElement.injector.get(CategoriesStore);
    const openEdit: MockInstance<CategoryDialogs['openEdit']> = vi
      .spyOn(dialogs, 'openEdit')
      .mockImplementation(() => undefined);
    const row: CategoryRow = categoryRow({ id: 1, name: 'Food' });
    // The menu reads only `row`; the other params are not needed for this assertion.
    const params: DataTableContextMenuParams<CategoryRow> = {
      row,
      selectedRows: [],
    } as unknown as DataTableContextMenuParams<CategoryRow>;

    const items: readonly DataTableMenuItem[] = options.getContextMenuItems(params);

    expect(items.length).toBe(1);
    const edit: DataTableMenuItem = items[0];
    if (
      typeof edit === 'string' ||
      !('nameKey' in edit) ||
      edit.nameKey !== 'categories.menuEdit'
    ) {
      throw new Error('expected the Edit entry');
    }
    edit.action();
    expect(openEdit).toHaveBeenCalledWith(store, row);
  });
});
