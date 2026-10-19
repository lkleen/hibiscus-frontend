import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { TableViewId } from '@hibiscus-frontend/shared/contracts/user-settings';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import { DataTableCellDirective } from '../../../shared/components/data-table/data-table-cell.directive';
import { DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import type {
  DataTableMenuItem,
  DataTableOptions,
  DataTableVisibleColDef,
} from '../../../shared/components/data-table/data-table.model';
import { TableDensityService } from '../../../core/services/table-density.service';
import { TranslationService } from '../../../core/services/translation.service';
import { RibbonBandDirective } from '../../../shared/components/ribbon/ribbon-band.directive';
import { RibbonGroupComponent } from '../../../shared/components/ribbon/ribbon-group.component';
import { tabDensityView } from '../transactions-tabs';
import { AmountCellComponent } from '../cells/amount-cell/amount-cell.component';
import { TransactionsSelectionBarComponent } from '../selection-bar/transactions-selection-bar.component';
import { TransactionDialogs } from '../transaction-dialogs';
import { TransactionsStore } from '../transactions.store';
import type { ExportDocument } from '../export/export.model';
import { buildListExport } from '../export/list-export';
import { TransactionsExport } from '../export/transactions-export';

/**
 * The transactions table over the shell's store. Sorting, column filters and paging are
 * `<app-data-table>`'s (a PrimeNG `p-table` underneath); the shared account/date/search filter
 * arrives as `externalFilter`. See the `transactions-table` skill.
 */
@Component({
  selector: 'app-transactions-list',
  templateUrl: './transactions-list.component.html',
  styleUrl: './transactions-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DataTableComponent,
    DataTableCellDirective,
    AmountCellComponent,
    TransactionsSelectionBarComponent,
    RibbonBandDirective,
    RibbonGroupComponent,
  ],
})
export class TransactionsListComponent {
  protected readonly store = inject(TransactionsStore);
  protected readonly i18n = inject(TranslationService);
  protected readonly densities: TableDensityService = inject(TableDensityService);
  protected readonly densityView: TableViewId = tabDensityView('list');
  private readonly dialogs = inject(TransactionDialogs);
  private readonly exporter = inject(TransactionsExport);
  private readonly table = viewChild.required(DataTableComponent<TransactionRow>);

  /** The ticked rows (ids); the table prunes it to the rows that pass the filters. */
  protected readonly selectedRowIds = signal<ReadonlySet<string | number>>(new Set());

  /** The store's options plus selection and the row menu: View, Edit and Assign. */
  protected readonly options: DataTableOptions<TransactionRow> = {
    ...this.store.listOptions,
    rowSelection: { mode: 'multiple' },
    getContextMenuItems: ({ row, selectedRows }): readonly DataTableMenuItem[] =>
      this.dialogs.menuItems({
        row,
        selectedRows,
        view: 'showDetails',
        onBulkAssigned: (): void => this.clearSelection(),
      }),
  };

  constructor() {
    // The Export band exports the table as shown: its visible columns, filters and sort, read
    // from the table only when a document is built.
    const unregister: () => void = this.exporter.register({
      view: this.densityView,
      maxDepth: null,
      build: (): ExportDocument =>
        buildListExport({
          snapshot: this.table().exportSnapshot(),
          labels: {
            title: this.i18n.t('transactions.export.docTitleList'),
            scope: this.exporter.scope(),
            header: (column: DataTableVisibleColDef<TransactionRow, unknown>): string =>
              this.i18n.t(column.headerKey),
          },
        }),
    });
    inject(DestroyRef).onDestroy(unregister);

    // A saved edit mutates its row in place (see `TransactionsStore.saveTransaction`), so the
    // table only needs a repaint, which keeps its page and filters. The first run is skipped:
    // nothing has been edited yet.
    let seenRevision: number = this.store.revision();
    effect((): void => {
      const revision: number = this.store.revision();
      untracked((): void => {
        if (revision === seenRevision) return;
        seenRevision = revision;
        this.table().refresh();
      });
    });
  }

  protected clearSelection(): void {
    this.selectedRowIds.set(new Set());
  }

  // `DataTableCellContext.value` is `unknown` by design — a cell renderer can be shared by columns
  // with different `Value` types, so the data-table component has no honest concrete type to hand
  // back (see the `colDef()` doc comment in `data-table.model.ts` for the same erasure). Narrowing
  // here, once, keeps the "amount" template's binding to `<app-transaction-amount-cell>` typed
  // without a template-level `$any()` cast. Fails loudly rather than defensively: the "amount"
  // renderer is only ever wired to `betrag`/`saldo`, both `number | null`, so anything else here
  // means a column was mis-wired to this renderer, not a value worth silently coercing to `null`.
  protected asAmount(value: unknown): number | null {
    if (value === null || typeof value === 'number') return value;
    throw new Error(`amount cell expects number | null, got ${typeof value}`);
  }
}
