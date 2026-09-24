import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { ColDef } from 'ag-grid-community';
import { installMutationObserverMock } from '../../utils/testing/mutation-observer-mock';
import { BaseTableComponent } from './base-table.component';
import { baseTableTheme } from './base-table.theme';

interface Row {
  name: string;
}

@Component({
  template: `<app-base-table [columnDefs]="columnDefs" [rowData]="rowData" />`,
  imports: [BaseTableComponent],
})
class HostComponent {
  readonly columnDefs: ColDef<Row>[] = [{ field: 'name', headerName: 'Name' }];
  readonly rowData: Row[] = [{ name: 'first' }, { name: 'second' }];
}

describe('BaseTableComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    installMutationObserverMock();
    TestBed.configureTestingModule({ imports: [HostComponent] });
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    vi.unstubAllGlobals();
  });

  it('accepts the ag-Grid inputs directly and renders the rows', () => {
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelectorAll('.ag-row').length).toBe(2);
    expect(el.querySelector('.ag-header-cell-text')?.textContent?.trim()).toBe('Name');
  });

  it('carries the project theme by default', () => {
    const table = fixture.debugElement.query(By.directive(BaseTableComponent));

    expect((table.componentInstance as BaseTableComponent<Row>).theme).toBe(baseTableTheme);
    expect((table.nativeElement as HTMLElement).classList).toContain('base-table');
  });
});
