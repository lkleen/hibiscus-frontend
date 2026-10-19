import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import type { TableViewId } from '@hibiscus-frontend/shared/contracts/user-settings';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import { TableDensityService } from '../../../core/services/table-density.service';
import { TranslationService } from '../../../core/services/translation.service';
import { RibbonBandDirective } from '../../../shared/components/ribbon/ribbon-band.directive';
import { RibbonGroupComponent } from '../../../shared/components/ribbon/ribbon-group.component';
import { tabDensityView } from '../transactions-tabs';
import { accountLabel } from '../../../core/utils/account-label';
import { toCssColor } from '../../../core/utils/category-color';
import { DataTableCellDirective } from '../../../shared/components/data-table/data-table-cell.directive';
import { DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import {
  colDef,
  showDetailsOf,
  type DataTableColDef,
  type DataTableMenuItem,
  type DataTableOptions,
  type DataTableVisibleColDef,
} from '../../../shared/components/data-table/data-table.model';
import { AmountCellComponent } from '../cells/amount-cell/amount-cell.component';
import { TransactionsSelectionBarComponent } from '../selection-bar/transactions-selection-bar.component';
import { CategoryDialogs } from '../../categories/category-dialogs';
import { TransactionDialogs } from '../transaction-dialogs';
import { TransactionsStore } from '../transactions.store';
import { buildCategoryExport, maxCategoryDepth } from '../export/category-export';
import type { ExportDepth, ExportDocument } from '../export/export.model';
import { TransactionsExport } from '../export/transactions-export';
import { buildCategoryReport, compareReportRows, type CategoryReportRow } from './category-report';

/**
 * "Umsätze nach Kategorien": the category tree with sums per category (over its subcategories)
 * and the transactions as leaves, over the shell's filtered transactions. Rows can be ticked to assign them a category in one go.
 */
@Component({
  selector: 'app-transactions-by-category',
  templateUrl: './transactions-by-category.component.html',
  styleUrl: './transactions-by-category.component.scss',
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
export class TransactionsByCategoryComponent {
  protected readonly store = inject(TransactionsStore);
  protected readonly i18n = inject(TranslationService);
  protected readonly densities: TableDensityService = inject(TableDensityService);
  protected readonly densityView: TableViewId = tabDensityView('categories');
  private readonly dialogs = inject(TransactionDialogs);
  private readonly categoryDialogs = inject(CategoryDialogs);
  private readonly exporter = inject(TransactionsExport);

  /** The ticked transaction leaves (ids); the table prunes it to the rows that pass the filters. */
  protected readonly selectedRowIds = signal<ReadonlySet<string | number>>(new Set());

  protected readonly rows = computed<CategoryReportRow[]>(() =>
    buildCategoryReport({
      transactions: this.store.filteredTransactions(),
      assignment: this.store.categoryAssignment().byTransactionId,
      categories: this.store.categories(),
    }),
  );

  protected readonly invalidPatternNames = computed<string>(() =>
    this.store
      .categoryAssignment()
      .invalidPatterns.map((category: CategoryRow) => category.name)
      .join(', '),
  );

  // Lambdas read signals when the table calls them, so the array is built once.
  protected readonly columns: readonly DataTableColDef<CategoryReportRow>[] = [
    colDef<CategoryReportRow, string | null>({
      colId: 'name',
      headerKey: 'transactions.byCategory.colName',
      filter: false,
      cellRenderer: 'categoryName',
      valueGetter: (row) => {
        if (row.kind === 'transaction') return row.transaction.empfaenger_name;
        return row.category === null
          ? this.i18n.t('transactions.byCategory.unassigned')
          : row.category.name;
      },
    }),
    this.transactionText('datum', 'transactions.colDate'),
    this.amountColumn('betrag', 'transactions.byCategory.colAmount', (amount) => amount),
    this.transactionText('zweck', 'transactions.colPurpose1'),
    this.transactionText('zweck2', 'transactions.colPurpose2'),
    this.transactionText('zweck3', 'transactions.colPurpose3'),
    this.amountColumn('income', 'transactions.byCategory.colIncome', (amount) =>
      amount > 0 ? amount : null,
    ),
    this.amountColumn('expenses', 'transactions.byCategory.colExpenses', (amount) =>
      amount < 0 ? amount : null,
    ),
    colDef<CategoryReportRow, string | null>({
      colId: 'konto',
      headerKey: 'transactions.byCategory.colAccount',
      filter: false,
      valueGetter: (row) => {
        if (row.kind === 'category') return null;
        const account: AccountRow | undefined = this.store
          .accountsById()
          .get(row.transaction.konto_id);
        if (!account) {
          throw new Error(
            `transaction ${row.transaction.id}: account ${row.transaction.konto_id} is not loaded`,
          );
        }
        return accountLabel(account);
      },
    }),
    colDef<CategoryReportRow, CategoryReportRow>({
      // Carries the tree order for `options.defaultSort`; the value is the row itself.
      colId: 'order',
      hide: true,
      filter: false,
      valueGetter: (row) => row,
      comparator: compareReportRows,
    }),
  ];

  protected readonly options: DataTableOptions<CategoryReportRow> = {
    treeData: { getParentId: (row) => row.parentId, groupColId: 'name', groupDefaultExpanded: 0 },
    getRowId: (row) => row.id,
    defaultSort: [{ colId: 'order', order: 1 }],
    autoSizeStrategy: { type: 'fitCellContents' },
    scrollHeight: 'flex',
    emptyKey: 'transactions.byCategory.empty',
    quickFilter: false,
    // Only transaction leaves can be ticked; category rows have no checkbox.
    rowSelection: {
      mode: 'multiple',
      isRowSelectable: (row: CategoryReportRow): boolean => row.kind === 'transaction',
    },
    // A transaction shows the list tab's details (its own columns) and can be edited or assigned;
    // a category node can be edited, the Unassigned node has no menu. In a multi-row selection the
    // transaction entries act on the selected transactions (see `TransactionDialogs.menuItems`).
    getContextMenuItems: ({ row, selectedRows }): readonly DataTableMenuItem[] => {
      if (row.kind === 'category') {
        const category: CategoryRow | null = row.category;
        if (category === null) return [];
        return [
          {
            nameKey: 'categories.menuEdit',
            action: (): void => this.categoryDialogs.openEdit(this.store, category),
          },
        ];
      }
      const transaction: TransactionRow = row.transaction;
      return this.dialogs.menuItems({
        row: transaction,
        selectedRows: selectedRows.flatMap((selected: CategoryReportRow): TransactionRow[] =>
          selected.kind === 'transaction' ? [selected.transaction] : [],
        ),
        view: showDetailsOf<TransactionRow>(this.store.transactionColumns, transaction),
        onBulkAssigned: (): void => this.clearSelection(),
      });
    },
  };

  constructor() {
    // The Export band exports this report while the tab is shown, with the table's columns and sums.
    const unregister: () => void = this.exporter.register({
      view: this.densityView,
      maxDepth: computed<number>((): number => maxCategoryDepth(this.rows())),
      build: (depth: ExportDepth): ExportDocument =>
        buildCategoryExport({
          rows: this.rows(),
          columns: this.columns,
          depth,
          labels: {
            title: this.i18n.t('transactions.export.docTitleByCategory'),
            scope: this.exporter.scope(),
            header: (column: DataTableVisibleColDef<CategoryReportRow, unknown>): string =>
              this.i18n.t(column.headerKey),
            total: this.i18n.t('transactions.export.total'),
          },
        }),
    });
    inject(DestroyRef).onDestroy(unregister);
  }

  private transactionText(
    colId: 'datum' | 'zweck' | 'zweck2' | 'zweck3',
    headerKey:
      | 'transactions.colDate'
      | 'transactions.colPurpose1'
      | 'transactions.colPurpose2'
      | 'transactions.colPurpose3',
  ): DataTableColDef<CategoryReportRow> {
    return colDef<CategoryReportRow, string | null>({
      colId,
      headerKey,
      filter: false,
      valueGetter: (row) => (row.kind === 'transaction' ? row.transaction[colId] : null),
    });
  }

  /** Leaves show their own value; a category's own value is 0 so an empty node shows 0 too. */
  private amountColumn(
    colId: string,
    headerKey:
      | 'transactions.byCategory.colAmount'
      | 'transactions.byCategory.colIncome'
      | 'transactions.byCategory.colExpenses',
    leafValue: (amount: number) => number | null,
  ): DataTableColDef<CategoryReportRow> {
    return colDef<CategoryReportRow, number | null>({
      colId,
      headerKey,
      filter: false,
      cellRenderer: 'amount',
      align: 'end',
      aggFunc: 'sum',
      valueGetter: (row) => (row.kind === 'category' ? 0 : leafValue(row.transaction.betrag)),
    });
  }

  /** A category's custom colour as CSS (Hibiscus colours only category nodes, and only when
   *  `customcolor = 1`); `null` for transactions, the unassigned node and uncoloured categories. */
  protected swatchColor(row: CategoryReportRow): string | null {
    if (row.kind === 'transaction' || row.category === null) return null;
    return toCssColor(row.category);
  }

  protected clearSelection(): void {
    this.selectedRowIds.set(new Set());
  }

  // See `TransactionsListComponent.asAmount`: the "amount" renderer is only wired to number columns.
  protected asAmount(value: unknown): number | null {
    if (value === null || typeof value === 'number') return value;
    throw new Error(`amount cell expects number | null, got ${typeof value}`);
  }
}
