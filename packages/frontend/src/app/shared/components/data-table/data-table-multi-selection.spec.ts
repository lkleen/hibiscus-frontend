import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DataTableComponent } from './data-table.component';
import type {
  DataTableColDef,
  DataTableContextMenuParams,
  DataTableMenuItem,
  DataTableOptions,
} from './data-table.model';
import { colDef } from './data-table.model';
import { installMutationObserverMock } from '../../../core/utils/testing/mutation-observer-mock';

interface ToyRow {
  readonly id: number;
  readonly name: string;
  readonly parentId: number | null;
}

const ROWS: readonly ToyRow[] = [
  { id: 1, name: 'Alpha', parentId: null },
  { id: 2, name: 'Bravo', parentId: null },
  { id: 3, name: 'Charlie', parentId: null },
  { id: 4, name: 'Delta', parentId: null },
];

const COLUMNS: readonly DataTableColDef<ToyRow, unknown>[] = [
  colDef<ToyRow, string>({ colId: 'name', headerKey: 'transactions.colRecipient' }),
];

@Component({
  selector: 'app-test-multi-selection-host',
  template: `
    <app-data-table
      [value]="rows()"
      [columns]="columns"
      [options]="options()"
      [(selectedRowIds)]="selectedIds"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DataTableComponent],
})
class MultiSelectionHostComponent {
  readonly rows = signal<readonly ToyRow[]>(ROWS);
  readonly columns: readonly DataTableColDef<ToyRow, unknown>[] = COLUMNS;
  readonly selectedIds = signal<ReadonlySet<string | number>>(new Set());
  readonly menuParams: DataTableContextMenuParams<ToyRow>[] = [];
  readonly options = signal<DataTableOptions<ToyRow>>({
    getRowId: (row: ToyRow): number => row.id,
    emptyKey: 'transactions.empty',
    rowSelection: { mode: 'multiple' },
    pagination: { pageSize: 2, pageSizes: [2, 10] },
    getContextMenuItems: (params: DataTableContextMenuParams<ToyRow>): DataTableMenuItem[] => {
      this.menuParams.push(params);
      return [{ nameKey: 'table.menuView', action: (): void => undefined }];
    },
  });
}

@Component({
  selector: 'app-test-multi-selection-tree-host',
  template: `
    <app-data-table
      [value]="rows"
      [columns]="columns"
      [options]="options"
      [(selectedRowIds)]="selectedIds"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DataTableComponent],
})
class MultiSelectionTreeHostComponent {
  readonly rows: readonly ToyRow[] = [
    { id: 1, name: 'Group', parentId: null },
    { id: 2, name: 'Leaf A', parentId: 1 },
    { id: 3, name: 'Leaf B', parentId: 1 },
    { id: 4, name: 'Other group', parentId: null },
    { id: 5, name: 'Leaf C', parentId: 4 },
  ];
  readonly columns: readonly DataTableColDef<ToyRow, unknown>[] = COLUMNS;
  readonly selectedIds = signal<ReadonlySet<string | number>>(new Set());
  readonly options: DataTableOptions<ToyRow> = {
    getRowId: (row: ToyRow): number => row.id,
    emptyKey: 'transactions.empty',
    rowSelection: {
      mode: 'multiple',
      isRowSelectable: (row: ToyRow): boolean => row.name.startsWith('Leaf'),
    },
    treeData: { getParentId: (row: ToyRow): number | null => row.parentId, groupColId: 'name' },
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ids(set: ReadonlySet<string | number>): (string | number)[] {
  return [...set].sort();
}

describe('DataTableComponent multi-row selection', () => {
  beforeEach(() => installMutationObserverMock());

  describe('flat', () => {
    let fixture: ComponentFixture<MultiSelectionHostComponent>;
    let host: MultiSelectionHostComponent;
    let root: HTMLElement;

    beforeEach(() => {
      fixture = TestBed.createComponent(MultiSelectionHostComponent);
      host = fixture.componentInstance;
      root = fixture.nativeElement as HTMLElement;
    });

    afterEach(() => fixture.destroy());

    async function settle(ms = 50): Promise<void> {
      fixture.detectChanges();
      await fixture.whenStable();
      await wait(ms);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    }

    function rows(): HTMLTableRowElement[] {
      return Array.from(root.querySelectorAll<HTMLTableRowElement>('tbody tr'));
    }

    function rowBox(index: number): HTMLInputElement {
      const box: HTMLInputElement | null = rows()[index].querySelector('.data-table__checkbox');
      if (!box) throw new Error(`row ${index} has no checkbox`);
      return box;
    }

    function headerBox(): HTMLInputElement {
      const box: HTMLInputElement | null = root.querySelector('thead .data-table__checkbox');
      if (!box) throw new Error('no header checkbox');
      return box;
    }

    function clickRow(index: number, init: MouseEventInit): void {
      const row: HTMLTableRowElement = rows()[index];
      row
        .querySelector('td:not(.data-table__select-cell)')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init }));
    }

    async function search(text: string): Promise<void> {
      const input: HTMLInputElement | null = root.querySelector('#filter-search');
      if (!input) throw new Error('no search input');
      input.value = text;
      input.dispatchEvent(new Event('input'));
      await settle(400);
    }

    it('is off by default: no checkbox column', async () => {
      host.options.set({
        getRowId: (row: ToyRow): number => row.id,
        emptyKey: 'transactions.empty',
      });
      await settle();

      expect(root.querySelector('.data-table__checkbox')).toBeNull();
    });

    it('a row checkbox toggles that row', async () => {
      await settle();

      rowBox(0).click();
      await settle();
      expect(ids(host.selectedIds())).toEqual([1]);
      expect(rows()[0].classList).toContain('data-table__row--selected');

      rowBox(0).click();
      await settle();
      expect(host.selectedIds().size).toBe(0);
    });

    it('a plain click on the row does nothing; Ctrl and Cmd toggle', async () => {
      await settle();

      clickRow(0, {});
      await settle();
      expect(host.selectedIds().size).toBe(0);

      clickRow(0, { ctrlKey: true });
      clickRow(1, { metaKey: true });
      await settle();
      expect(ids(host.selectedIds())).toEqual([1, 2]);

      clickRow(0, { ctrlKey: true });
      await settle();
      expect(ids(host.selectedIds())).toEqual([2]);
    });

    it('Shift-click adds the range from the last toggled row, across pages', async () => {
      host.options.set({
        ...host.options(),
        pagination: false,
      } as DataTableOptions<ToyRow>);
      await settle();

      clickRow(0, { ctrlKey: true });
      clickRow(2, { shiftKey: true });
      await settle();

      expect(ids(host.selectedIds())).toEqual([1, 2, 3]);
    });

    it('the header checkbox selects every row of every page, is tri-state and toggles back', async () => {
      await settle();
      expect(headerBox().checked).toBe(false);
      expect(headerBox().indeterminate).toBe(false);

      rowBox(0).click();
      await settle();
      expect(headerBox().indeterminate).toBe(true);

      headerBox().click();
      await settle();
      expect(ids(host.selectedIds())).toEqual([1, 2, 3, 4]);
      expect(headerBox().checked).toBe(true);
      expect(headerBox().indeterminate).toBe(false);

      headerBox().click();
      await settle();
      expect(host.selectedIds().size).toBe(0);
    });

    it('prunes the selection to the rows that pass the filter, and never loops', async () => {
      host.selectedIds.set(new Set([1, 2, 99]));
      await settle();
      // 99 is in no row of `value`.
      expect(ids(host.selectedIds())).toEqual([1, 2]);

      await search('bravo');
      expect(ids(host.selectedIds())).toEqual([2]);

      // The header only covers what is visible now: it is fully checked and clears just that row.
      expect(headerBox().checked).toBe(true);
      headerBox().click();
      await settle();
      expect(host.selectedIds().size).toBe(0);
    });

    it('prunes a row that leaves value()', async () => {
      host.selectedIds.set(new Set([3, 4]));
      await settle();
      host.rows.set(ROWS.filter((row: ToyRow): boolean => row.id !== 4));
      await settle();

      expect(ids(host.selectedIds())).toEqual([3]);
    });

    it('passes the selected raw rows to the context menu params', async () => {
      host.selectedIds.set(new Set([3, 1]));
      await settle();

      rows()[1]
        .querySelector('td:not(.data-table__select-cell)')
        ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      await settle();

      const params: DataTableContextMenuParams<ToyRow> =
        host.menuParams[host.menuParams.length - 1];
      expect(params.row.id).toBe(2);
      expect(params.selectedRows.map((row: ToyRow): number => row.id)).toEqual([1, 3]);
    });
  });

  describe('tree', () => {
    let fixture: ComponentFixture<MultiSelectionTreeHostComponent>;
    let root: HTMLElement;

    beforeEach(() => {
      fixture = TestBed.createComponent(MultiSelectionTreeHostComponent);
      root = fixture.nativeElement as HTMLElement;
    });

    afterEach(() => fixture.destroy());

    async function settle(ms = 50): Promise<void> {
      fixture.detectChanges();
      await fixture.whenStable();
      await wait(ms);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    }

    function rows(): HTMLTableRowElement[] {
      return Array.from(root.querySelectorAll<HTMLTableRowElement>('tbody tr'));
    }

    it('shows no checkbox on rows isRowSelectable rejects', async () => {
      await settle();

      expect(
        rows().map(
          (row: HTMLTableRowElement): boolean =>
            row.querySelector('.data-table__checkbox') !== null,
        ),
      ).toEqual([false, true, true, false, true]);
    });

    it('the header selects only the selectable filtered nodes, collapsed ones included', async () => {
      await settle();
      root.querySelector<HTMLButtonElement>('[aria-label="Collapse all"]')?.click();
      await settle();

      root.querySelector<HTMLInputElement>('thead .data-table__checkbox')?.click();
      await settle();
      expect(ids(fixture.componentInstance.selectedIds())).toEqual([2, 3, 5]);

      const input: HTMLInputElement | null = root.querySelector('#filter-search');
      if (!input) throw new Error('no search input');
      input.value = 'leaf c';
      input.dispatchEvent(new Event('input'));
      await settle(400);
      expect(ids(fixture.componentInstance.selectedIds())).toEqual([5]);
    });

    it('Shift-click only toggles in the tree', async () => {
      await settle();

      rows()[1]
        .querySelector('td:not(.data-table__select-cell)')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
      rows()[4]
        .querySelector('td:not(.data-table__select-cell)')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
      await settle();

      expect(ids(fixture.componentInstance.selectedIds())).toEqual([2, 5]);
    });
  });
});
