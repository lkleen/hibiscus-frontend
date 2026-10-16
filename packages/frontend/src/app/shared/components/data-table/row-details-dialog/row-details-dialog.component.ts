import { NgTemplateOutlet } from '@angular/common';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  TemplateRef,
  ViewEncapsulation,
  inject,
} from '@angular/core';
import { TranslationService } from '../../../../core/services/translation.service';
import type { DataTableVisibleColDef } from '../data-table.model';

/** The `ariaLabelledBy` target of the dialog (`DataTableComponent.openRowDetails`). */
export const ROW_DETAILS_TITLE_ID = 'data-table-row-details-title';

/** Panel/backdrop classes the dialog is opened with; styled by this component (see its scss). */
export const ROW_DETAILS_PANEL_CLASS = 'data-table-details-panel';
export const ROW_DETAILS_BACKDROP_CLASS = 'data-table-details-backdrop';

/** What `DataTableComponent` hands to the dialog. */
export interface DataTableRowDetailsData<Row> {
  /** The table's own `#cellContent` template, so values render exactly as in the table. */
  readonly cellContent: TemplateRef<unknown>;
  readonly columns: readonly DataTableVisibleColDef<Row, unknown>[];
  /** The raw row. */
  readonly row: Row;
}

/** Lists every visible column of one row: header label plus the cell as the table renders it. */
@Component({
  selector: 'app-data-table-row-details',
  templateUrl: './row-details-dialog.component.html',
  styleUrl: './row-details-dialog.component.scss',
  // None: the CDK overlay pane and backdrop live outside this component's view, and the host
  // element is the dialog sheet.
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet],
})
export class DataTableRowDetailsComponent<Row extends object> {
  protected readonly i18n = inject(TranslationService);
  protected readonly data: DataTableRowDetailsData<Row> =
    inject<DataTableRowDetailsData<Row>>(DIALOG_DATA);
  private readonly dialogRef: DialogRef<void, DataTableRowDetailsComponent<Row>> =
    inject<DialogRef<void, DataTableRowDetailsComponent<Row>>>(DialogRef);

  protected readonly titleId: string = ROW_DETAILS_TITLE_ID;

  protected close(): void {
    this.dialogRef.close();
  }
}
