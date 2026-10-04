import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { DataTableCellDirective } from './data-table-cell.directive';
import { DataTableComponent } from './data-table.component';
import { colDef } from './data-table.model';
import type { DataTableColDef, DataTableOptions } from './data-table.model';
import { installMutationObserverMock } from '../../../core/utils/testing/mutation-observer-mock';

interface Node {
  readonly id: number;
  readonly parentId: number | null;
  readonly name: string;
  readonly amount: number;
}

/** Alpha(1) > Bravo(2) > Delta(4), Alpha > Charlie(3), Zulu(5). */
function nodes(): Node[] {
  return [
    { id: 1, parentId: null, name: 'Alpha', amount: 10 },
    { id: 2, parentId: 1, name: 'Bravo', amount: 20 },
    { id: 3, parentId: 1, name: 'Charlie', amount: 30 },
    { id: 4, parentId: 2, name: 'Delta', amount: 40 },
    { id: 5, parentId: null, name: 'Zulu', amount: 50 },
  ];
}

const COLUMNS: readonly DataTableColDef<Node, unknown>[] = [
  colDef<Node, string>({ colId: 'name', headerKey: 'transactions.colRecipient' }),
  colDef<Node, number>({ colId: 'amount', headerKey: 'transactions.colAmount' }),
  colDef<Node, string>({
    colId: 'custom',
    headerKey: 'table.searchPlaceholder',
    cellRenderer: 'custom',
    valueGetter: (row: Node): string => `custom:${row.name}`,
  }),
];

function treeOptions(overrides: Partial<DataTableOptions<Node>> = {}): DataTableOptions<Node> {
  return {
    getRowId: (row: Node): number => row.id,
    emptyKey: 'transactions.empty',
    treeData: { getParentId: (row: Node): number | null => row.parentId, groupColId: 'name' },
    ...overrides,
  } as DataTableOptions<Node>;
}

@Component({
  selector: 'app-test-tree-host',
  template: `
    <app-data-table
      [value]="rows()"
      [columns]="columns()"
      [options]="options()"
      [externalFilter]="externalFilter()"
    >
      <ng-template appDataTableCell="custom" let-row>
        <span class="custom-cell">{{ capture(row) }}</span>
      </ng-template>
    </app-data-table>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DataTableComponent, DataTableCellDirective],
})
class TreeHostComponent {
  readonly rows = signal<readonly Node[]>(nodes());
  readonly columns = signal<readonly DataTableColDef<Node, unknown>[]>(COLUMNS);
  readonly options = signal<DataTableOptions<Node>>(treeOptions());
  readonly externalFilter = signal<((row: Node) => boolean) | null>(null);
  readonly captured: Node[] = [];

  capture(row: Node): string {
    this.captured.push(row);
    return '';
  }
}

describe('DataTableComponent tree mode', () => {
  let fixture: ComponentFixture<TreeHostComponent>;
  let host: TreeHostComponent;
  let root: HTMLElement;

  beforeEach(() => {
    installMutationObserverMock();
    TestBed.configureTestingModule({ imports: [TreeHostComponent] });
    fixture = TestBed.createComponent(TreeHostComponent);
    host = fixture.componentInstance;
    root = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    fixture.destroy();
    vi.unstubAllGlobals();
  });

  function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    await wait(50);
    fixture.detectChanges();
  }

  /** PrimeNG debounces `filter()`/`filterGlobal()` by 300 ms. */
  async function settleAfterFilter(): Promise<void> {
    await wait(350);
    await settle();
  }

  function bodyRows(): HTMLTableRowElement[] {
    return Array.from(root.querySelectorAll<HTMLTableRowElement>('tbody tr')).filter(
      (row) => !row.querySelector('td[colspan]'),
    );
  }

  function names(): string[] {
    return bodyRows().map((row) => row.children[0].textContent?.trim() ?? '');
  }

  function table(): DataTableComponent<Node> {
    return fixture.debugElement.query(By.directive(DataTableComponent))
      .componentInstance as DataTableComponent<Node>;
  }

  function type(selector: string, value: string): void {
    const input = root.querySelector<HTMLInputElement>(selector);
    if (!input) throw new Error(`no input ${selector}`);
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  function actionButtons(): HTMLButtonElement[] {
    return Array.from(root.querySelectorAll<HTMLButtonElement>('.filters__action'));
  }

  it('renders a TreeTable, not a Table, and every level expanded by default', async () => {
    await settle();
    expect(root.querySelector('p-treetable')).toBeTruthy();
    expect(root.querySelector('p-table')).toBeNull();
    expect(names()).toEqual(['Alpha', 'Bravo', 'Delta', 'Charlie', 'Zulu']);
  });

  it('puts the toggler in the group column only, and hides it on leaf rows', async () => {
    await settle();
    for (const row of bodyRows()) {
      expect(row.children[0].querySelector('p-treetabletoggler, p-treeTableToggler')).toBeTruthy();
      expect(row.children[1].querySelector('p-treetabletoggler, p-treeTableToggler')).toBeNull();
    }
    const buttons = Array.from(
      root.querySelectorAll<HTMLElement>(
        'button.p-treetable-node-toggle-button, .p-treetable-toggler',
      ),
    );
    const hidden = buttons.filter((button) => button.style.visibility === 'hidden');
    expect(buttons.length).toBe(5);
    expect(hidden.length).toBe(3); // Delta, Charlie, Zulu
  });

  it('collapse all and expand all rebuild the tree', async () => {
    await settle();
    actionButtons()[1].click();
    await settle();
    expect(names()).toEqual(['Alpha', 'Zulu']);

    actionButtons()[0].click();
    await settle();
    expect(names()).toEqual(['Alpha', 'Bravo', 'Delta', 'Charlie', 'Zulu']);
  });

  it('honours groupDefaultExpanded', async () => {
    host.options.set(
      treeOptions({
        treeData: {
          getParentId: (row: Node): number | null => row.parentId,
          groupColId: 'name',
          groupDefaultExpanded: 1,
        },
      }),
    );
    await settle();
    expect(names()).toEqual(['Alpha', 'Bravo', 'Charlie', 'Zulu']);
  });

  it('the public expandAll()/collapseAll() work like the buttons', async () => {
    await settle();
    table().collapseAll();
    await settle();
    expect(names()).toEqual(['Alpha', 'Zulu']);
    table().expandAll();
    await settle();
    expect(names().length).toBe(5);
  });

  it('the quick filter is lenient: a match keeps its ancestors', async () => {
    await settle();
    type('#filter-search', 'delta');
    await settleAfterFilter();
    expect(names()).toEqual(['Alpha', 'Bravo', 'Delta']);
  });

  it('the column filter keeps ancestors too', async () => {
    await settle();
    type('.data-table__tree-filter', 'delta');
    await settleAfterFilter();
    expect(names()).toEqual(['Alpha', 'Bravo', 'Delta']);
  });

  it('sorts within each level', async () => {
    host.options.set(treeOptions({ defaultSort: [{ colId: 'name', order: -1 }] }));
    await settle();
    expect(names()).toEqual(['Zulu', 'Alpha', 'Charlie', 'Bravo', 'Delta']);
  });

  it('clicking a sortable header sorts the tree', async () => {
    await settle();
    const header = root.querySelector<HTMLElement>(
      'th[data-pc-section="headercell"], th.p-sortable-column',
    );
    if (!header) throw new Error('no sortable header');
    header.click();
    header.click();
    await settle();
    expect(names()[0]).toBe('Zulu');
  });

  it('the cell renderer gets the raw row', async () => {
    await settle();
    expect(host.captured.length).toBeGreaterThan(0);
    const raw: readonly Node[] = host.rows();
    for (const row of host.captured) {
      expect(raw).toContain(row);
    }
  });

  it('refresh() keeps the expansion the user chose', async () => {
    await settle();
    const toggler = root.querySelector<HTMLElement>(
      'p-treetabletoggler button, p-treeTableToggler button',
    );
    if (!toggler) throw new Error('no toggler');
    toggler.click(); // collapse Alpha
    await settle();
    expect(names()).toEqual(['Alpha', 'Zulu']);

    table().refresh();
    await settle();
    expect(names()).toEqual(['Alpha', 'Zulu']);
  });

  it('throws on a numeric or date column filter', () => {
    host.columns.set([
      ...COLUMNS,
      colDef<Node, number>({ colId: 'n', headerKey: 'table.filterSearch', filter: 'numeric' }),
    ]);
    expect(() => {
      fixture.detectChanges();
    }).toThrow(/numeric filter/);
  });

  it('throws when an external filter is set', () => {
    host.externalFilter.set(() => true);
    expect(() => {
      fixture.detectChanges();
    }).toThrow(/externalFilter/);
  });

  it('throws on a pagination object', () => {
    host.options.set(
      treeOptions({ pagination: { pageSize: 10, pageSizes: [10] } } as Partial<
        DataTableOptions<Node>
      >),
    );
    expect(() => {
      fixture.detectChanges();
    }).toThrow(/pagination/);
  });

  it('throws on a missing group column', () => {
    host.options.set(
      treeOptions({
        treeData: { getParentId: (row: Node): number | null => row.parentId, groupColId: 'nope' },
      }),
    );
    expect(() => {
      fixture.detectChanges();
    }).toThrow(/groupColId/);
  });

  describe('aggFunc sum', () => {
    const AGG_COLUMNS: readonly DataTableColDef<Node, unknown>[] = [
      COLUMNS[0],
      colDef<Node, number>({
        colId: 'amount',
        headerKey: 'transactions.colAmount',
        aggFunc: 'sum',
      }),
    ];

    function amounts(): string[] {
      return bodyRows().map((row) => row.children[1].textContent?.trim() ?? '');
    }

    it('shows the leaf sum on group nodes and the own value on leaves', async () => {
      host.columns.set(AGG_COLUMNS);
      await settle();
      expect(names()).toEqual(['Alpha', 'Bravo', 'Delta', 'Charlie', 'Zulu']);
      expect(amounts()).toEqual(['70', '40', '40', '30', '50']);
    });

    it('sorts group nodes by their aggregate', async () => {
      host.columns.set(AGG_COLUMNS);
      host.options.set(treeOptions({ defaultSort: [{ colId: 'amount', order: -1 }] }));
      await settle();
      // Own values would put Zulu (50) before Alpha (10) and Charlie before Bravo.
      expect(names()).toEqual(['Alpha', 'Bravo', 'Delta', 'Charlie', 'Zulu']);
    });

    it('throws on a flat table with an aggFunc column', () => {
      host.columns.set(AGG_COLUMNS);
      host.options.set({ getRowId: (row: Node): number => row.id, emptyKey: 'transactions.empty' });
      expect(() => {
        fixture.detectChanges();
      }).toThrow(/aggFunc/);
    });
  });

  it('expandAll() on a flat table throws', async () => {
    host.options.set({ getRowId: (row: Node): number => row.id, emptyKey: 'transactions.empty' });
    await settle();
    expect(() => {
      table().expandAll();
    }).toThrow(/tree mode/);
  });
});
