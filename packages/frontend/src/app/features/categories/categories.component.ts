import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import { forkJoin } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { TranslationService } from '../../core/services/translation.service';
import { toCssColor } from '../../core/utils/category-color';
import { DataTableCellDirective } from '../../shared/components/data-table/data-table-cell.directive';
import { DataTableComponent } from '../../shared/components/data-table/data-table.component';
import {
  colDef,
  type DataTableColDef,
  type DataTableOptions,
} from '../../shared/components/data-table/data-table.model';
import { ColorCellComponent } from './cells/color-cell/color-cell.component';

/** Hibiscus `umsatztyp.flags` bit 1 (`FLAG_SKIP_REPORTS`). */
const FLAG_SKIP_REPORTS = 1;

const DASH = '—';

/**
 * The read-only category tree (Hibiscus `umsatztyp`), shown with `<app-data-table>` in tree mode.
 * Every column is the stored value, translated the way Hibiscus shows it.
 */
@Component({
  selector: 'app-categories',
  templateUrl: './categories.component.html',
  styleUrl: './categories.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DataTableComponent, DataTableCellDirective, ColorCellComponent],
})
export class CategoriesComponent {
  private readonly api = inject(ApiService);
  protected readonly i18n = inject(TranslationService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly items = signal<CategoryRow[]>([]);
  private readonly accounts = signal<AccountRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);

  private readonly accountsById = computed(
    () => new Map(this.accounts().map((account) => [account.id, account])),
  );

  // Lookups and translations are lambdas evaluated live (they read signals when the table calls
  // them), so the array itself is built once.
  protected readonly columns: readonly DataTableColDef<CategoryRow>[] = [
    { colId: 'name', headerKey: 'categories.colName' },
    { colId: 'nummer', headerKey: 'categories.colNumber' },
    colDef<CategoryRow, number | null>({
      colId: 'umsatztyp',
      headerKey: 'categories.colType',
      valueFormatter: (value) => this.typeLabel(value),
      filterValueGetter: (row) => this.typeLabel(row.umsatztyp),
      getQuickFilterText: (value) => this.typeLabel(value),
    }),
    { colId: 'pattern', headerKey: 'categories.colPattern' },
    colDef<CategoryRow, number | null>({
      colId: 'isregex',
      headerKey: 'categories.colIsRegex',
      valueFormatter: (value) => this.yesNo(value),
      filterValueGetter: (row) => this.yesNo(row.isregex),
      getQuickFilterText: (value) => this.yesNo(value),
    }),
    colDef<CategoryRow, string | null>({
      colId: 'color',
      headerKey: 'categories.colColor',
      valueGetter: (row) => toCssColor(row),
      cellRenderer: 'color',
      filter: false,
    }),
    colDef<CategoryRow, number | null>({
      colId: 'customcolor',
      headerKey: 'categories.colCustomColor',
      valueFormatter: (value) => this.yesNo(value),
      filterValueGetter: (row) => this.yesNo(row.customcolor),
      getQuickFilterText: (value) => this.yesNo(value),
    }),
    { colId: 'kommentar', headerKey: 'categories.colComment' },
    colDef<CategoryRow, number | null>({
      colId: 'flags',
      headerKey: 'categories.colFlags',
      valueFormatter: (value) => this.flagsLabel(value),
      filterValueGetter: (row) => this.flagsLabel(row.flags),
      getQuickFilterText: (value) => this.flagsLabel(value),
    }),
    colDef<CategoryRow, string | null>({
      colId: 'konto',
      headerKey: 'categories.colAccount',
      valueGetter: (row) => this.accountLabel(row),
    }),
    { colId: 'konto_kategorie', headerKey: 'categories.colAccountCategory' },
    {
      // The column exists only to carry the id tie-break for `options.defaultSort` below.
      colId: 'id',
      hide: true,
      filter: false,
    },
  ];

  protected readonly options: DataTableOptions<CategoryRow> = {
    treeData: { getParentId: (row) => row.parent_id, groupColId: 'name' },
    getRowId: (row) => row.id,
    defaultSort: [
      { colId: 'name', order: 1 },
      { colId: 'id', order: 1 },
    ],
    autoSizeStrategy: { type: 'fitCellContents' },
    scrollHeight: 'flex',
    emptyKey: 'categories.empty',
  };

  constructor() {
    // Both are needed before the first render: a `konto_id` that is not among the accounts throws.
    forkJoin({ accounts: this.api.getAccounts(), categories: this.api.getCategories() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ accounts, categories }) => {
          this.accounts.set(accounts);
          this.items.set(categories);
          this.loading.set(false);
        },
        error: () => {
          this.error.set(true);
          this.loading.set(false);
        },
      });
  }

  // `DataTableCellContext.value` is `unknown`; the "color" renderer is only wired to the `color`
  // column, whose value is `string | null`. Anything else means a mis-wired column.
  protected asCssColor(value: unknown): string | null {
    if (value === null || typeof value === 'string') return value;
    throw new Error(`color cell expects string | null, got ${typeof value}`);
  }

  /** 0 = expense, 1 = income, 2 or NULL = any (as Hibiscus shows it); anything else raw. */
  private typeLabel(value: number | null): string {
    if (value === null || value === 2) return this.i18n.t('categories.type.any');
    if (value === 0) return this.i18n.t('categories.type.expense');
    if (value === 1) return this.i18n.t('categories.type.income');
    return String(value);
  }

  /** Hibiscus counts a boolean column as true only when it is exactly 1. */
  private yesNo(value: number | null): string {
    return this.i18n.t(value === 1 ? 'categories.yes' : 'categories.no');
  }

  private flagsLabel(value: number | null): string {
    if (value === null || value === 0) return DASH;
    const parts: string[] = [];
    if ((value & FLAG_SKIP_REPORTS) !== 0) parts.push(this.i18n.t('categories.flag.skipReports'));
    const other: number = value & ~FLAG_SKIP_REPORTS;
    if (other !== 0) parts.push(String(other));
    return parts.join(', ');
  }

  private accountLabel(row: CategoryRow): string | null {
    if (row.konto_id === null) return null;
    const account: AccountRow | undefined = this.accountsById().get(row.konto_id);
    if (!account) throw new Error(`category ${row.id}: account ${row.konto_id} is not loaded`);
    return account.bezeichnung ?? account.name;
  }
}
