import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import { TranslationService } from '../../../core/services/translation.service';
import { accountLabel } from '../../../core/utils/account-label';
import { DataTableCellDirective } from '../../../shared/components/data-table/data-table-cell.directive';
import { DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import {
  colDef,
  type DataTableColDef,
  type DataTableOptions,
} from '../../../shared/components/data-table/data-table.model';
import { AmountCellComponent } from '../cells/amount-cell/amount-cell.component';
import { TransactionsStore } from '../transactions.store';
import { buildCategoryReport, type CategoryReportRow } from './category-report';

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'accent' });
}

/**
 * Categories before transactions; categories by number then name with the unassigned node last;
 * transactions newest booking first. Ascending, as the data-table expects of a comparator.
 */
function compareReportRows(a: CategoryReportRow, b: CategoryReportRow): number {
  if (a.kind === 'category' && b.kind === 'category') {
    if (a.category === null || b.category === null) {
      return Number(a.category === null) - Number(b.category === null);
    }
    return (
      compareText(a.category.nummer ?? '', b.category.nummer ?? '') ||
      compareText(a.category.name, b.category.name) ||
      a.category.id - b.category.id
    );
  }
  if (a.kind === 'category') return -1;
  if (b.kind === 'category') return 1;
  return (
    compareText(b.transaction.datum, a.transaction.datum) || b.transaction.id - a.transaction.id
  );
}

/**
 * "Umsätze nach Kategorien": the category tree with sums per category (over its subcategories)
 * and the transactions as leaves, over the shell's filtered transactions. Read-only.
 */
@Component({
  selector: 'app-transactions-by-category',
  templateUrl: './transactions-by-category.component.html',
  styleUrl: './transactions-by-category.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DataTableComponent, DataTableCellDirective, AmountCellComponent],
})
export class TransactionsByCategoryComponent {
  protected readonly store = inject(TransactionsStore);
  protected readonly i18n = inject(TranslationService);

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
      valueGetter: (row) => {
        if (row.kind === 'transaction') return row.transaction.empfaenger_name;
        return row.category === null
          ? this.i18n.t('transactions.byCategory.unassigned')
          : row.category.name;
      },
    }),
    this.transactionText('datum', 'transactions.colDate'),
    this.transactionText('zweck', 'transactions.colPurpose1'),
    this.transactionText('zweck2', 'transactions.colPurpose2'),
    this.transactionText('zweck3', 'transactions.colPurpose3'),
    this.amountColumn('betrag', 'transactions.byCategory.colAmount', (amount) => amount),
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
  };

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

  // See `TransactionsListComponent.asAmount`: the "amount" renderer is only wired to number columns.
  protected asAmount(value: unknown): number | null {
    if (value === null || typeof value === 'number') return value;
    throw new Error(`amount cell expects number | null, got ${typeof value}`);
  }
}
