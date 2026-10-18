import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { TableDensity } from '@hibiscus-frontend/shared/contracts/user-settings';
import { DataTableComponent } from './data-table.component';
import type { DataTableColDef, DataTableOptions } from './data-table.model';
import { colDef } from './data-table.model';
import { installMutationObserverMock } from '../../../core/utils/testing/mutation-observer-mock';

interface ToyRow {
  readonly id: number;
  readonly name: string;
  readonly parentId: number | null;
}

const COLUMNS: readonly DataTableColDef<ToyRow, unknown>[] = [
  colDef<ToyRow, string>({ colId: 'name', headerKey: 'transactions.colRecipient' }),
];

const FLAT_ROWS: readonly ToyRow[] = [
  { id: 1, name: 'Alpha', parentId: null },
  { id: 2, name: 'Bravo', parentId: null },
  { id: 3, name: 'Alpine', parentId: null },
];

const TREE_ROWS: readonly ToyRow[] = [
  { id: 1, name: 'Group', parentId: null },
  { id: 2, name: 'Leaf A', parentId: 1 },
  { id: 3, name: 'Leaf B', parentId: 1 },
  { id: 4, name: 'Other group', parentId: null },
  { id: 5, name: 'Leaf C', parentId: 4 },
];

@Component({
  selector: 'app-test-density-quick-filter-host',
  template: `
    <app-data-table
      [value]="rows()"
      [columns]="columns"
      [options]="options()"
      [density]="density()"
      [quickFilterText]="text()"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DataTableComponent],
})
class HostComponent {
  readonly rows = signal<readonly ToyRow[]>(FLAT_ROWS);
  readonly columns: readonly DataTableColDef<ToyRow, unknown>[] = COLUMNS;
  readonly density = signal<TableDensity>('normal');
  readonly text = signal<string | null>(null);
  readonly options = signal<DataTableOptions<ToyRow>>({
    getRowId: (row: ToyRow): number => row.id,
    emptyKey: 'transactions.empty',
    pagination: { pageSize: 2, pageSizes: [2, 10] },
  });
}

@Component({
  selector: 'app-test-density-default-host',
  template: `<app-data-table [value]="rows" [columns]="columns" [options]="options" />`,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DataTableComponent],
})
class DefaultHostComponent {
  readonly rows: readonly ToyRow[] = FLAT_ROWS;
  readonly columns: readonly DataTableColDef<ToyRow, unknown>[] = COLUMNS;
  readonly options: DataTableOptions<ToyRow> = {
    getRowId: (row: ToyRow): number => row.id,
    emptyKey: 'transactions.empty',
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function densityClasses(root: HTMLElement): string[] {
  const table: HTMLElement | null = root.querySelector('app-data-table');
  if (!table) throw new Error('no app-data-table');
  return Array.from(table.classList).filter((c: string): boolean => c.startsWith('table-density-'));
}

describe('DataTableComponent density and quickFilterText', () => {
  beforeEach(() => installMutationObserverMock());

  describe('density', () => {
    it('defaults to exactly the normal class', () => {
      const fixture: ComponentFixture<DefaultHostComponent> =
        TestBed.createComponent(DefaultHostComponent);
      fixture.detectChanges();
      expect(densityClasses(fixture.nativeElement as HTMLElement)).toEqual([
        'table-density-normal',
      ]);
      fixture.destroy();
    });

    it('follows the input, one class at a time', () => {
      const fixture: ComponentFixture<HostComponent> = TestBed.createComponent(HostComponent);
      fixture.detectChanges();
      fixture.componentInstance.density.set('compact');
      fixture.detectChanges();
      expect(densityClasses(fixture.nativeElement as HTMLElement)).toEqual([
        'table-density-compact',
      ]);
      fixture.destroy();
    });
  });

  describe('quickFilterText', () => {
    let fixture: ComponentFixture<HostComponent>;
    let host: HostComponent;
    let root: HTMLElement;

    beforeEach(() => {
      fixture = TestBed.createComponent(HostComponent);
      host = fixture.componentInstance;
      root = fixture.nativeElement as HTMLElement;
    });

    afterEach(() => fixture.destroy());

    async function settle(): Promise<void> {
      fixture.detectChanges();
      await fixture.whenStable();
      await wait(50);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    }

    function bodyText(): string[] {
      return Array.from(root.querySelectorAll<HTMLTableRowElement>('tbody tr')).map(
        (r: HTMLTableRowElement): string => (r.textContent ?? '').trim(),
      );
    }

    function searchField(): HTMLInputElement | null {
      return root.querySelector<HTMLInputElement>('input[type="search"]');
    }

    it('filters flat rows, hides the own field and restores it empty on null', async () => {
      await settle();
      expect(searchField()).not.toBeNull();
      expect(bodyText().length).toBe(2);

      host.text.set('alp');
      await settle();
      expect(searchField()).toBeNull();
      const filtered: string = bodyText().join(' | ');
      expect(bodyText().length).toBe(2);
      expect(filtered).toContain('Alpha');
      expect(filtered).toContain('Alpine');
      expect(filtered).not.toContain('Bravo');

      host.text.set(null);
      await settle();
      expect(searchField()?.value).toBe('');
      expect(bodyText().join(' | ')).toContain('Bravo');
    });

    it('filters tree rows and keeps ancestors of matches', async () => {
      host.rows.set(TREE_ROWS);
      host.options.set({
        getRowId: (row: ToyRow): number => row.id,
        emptyKey: 'transactions.empty',
        treeData: {
          getParentId: (row: ToyRow): number | null => row.parentId,
          groupColId: 'name',
        },
      });
      await settle();
      host.text.set('Leaf C');
      await settle();
      expect(searchField()).toBeNull();
      const text: string = bodyText().join(' | ');
      expect(text).toContain('Other group');
      expect(text).toContain('Leaf C');
      expect(text).not.toContain('Leaf A');
      expect(text).not.toContain('Leaf B');
    });
  });
});
