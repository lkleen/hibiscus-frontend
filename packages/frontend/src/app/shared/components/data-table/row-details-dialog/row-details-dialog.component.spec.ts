import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Component, TemplateRef, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  DataTableRowDetailsComponent,
  type DataTableRowDetailsData,
} from './row-details-dialog.component';

interface Row {
  readonly name: string;
}

@Component({
  template: `<ng-template #cell let-column="column" let-row="row"
    ><b class="probe">{{ column.colId }}={{ row.name }}</b></ng-template
  >`,
})
class TemplateHostComponent {
  readonly cell = viewChild.required<TemplateRef<unknown>>('cell');
}

describe('DataTableRowDetailsComponent', () => {
  it('renders one entry per column through the cell template and closes via the ref', async () => {
    const close = vi.fn();
    const holder: { data?: DataTableRowDetailsData<Row> } = {};
    TestBed.configureTestingModule({
      providers: [
        {
          provide: DIALOG_DATA,
          useFactory: (): DataTableRowDetailsData<Row> | undefined => holder.data,
        },
        { provide: DialogRef, useValue: { close } },
      ],
    });
    const host = TestBed.createComponent(TemplateHostComponent);
    host.detectChanges();
    holder.data = {
      cellContent: host.componentInstance.cell(),
      columns: [
        { colId: 'name', headerKey: 'transactions.colRecipient' },
        { colId: 'other', headerKey: 'transactions.colAmount' },
      ],
      row: { name: 'Ada' },
    };
    const fixture = TestBed.createComponent(DataTableRowDetailsComponent);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement as HTMLElement;

    expect(root.querySelectorAll('dt').length).toBe(2);
    expect(Array.from(root.querySelectorAll('.probe')).map((e) => e.textContent)).toEqual([
      'name=Ada',
      'other=Ada',
    ]);

    root.querySelector<HTMLButtonElement>('.data-table-details__close')?.click();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
