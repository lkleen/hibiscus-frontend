import { CdkPortalOutlet } from '@angular/cdk/portal';
import {
  ChangeDetectionStrategy,
  Component,
  Signal,
  WritableSignal,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import type { TaxSection, TaxTagCode } from '@hibiscus-frontend/shared/contracts/tax-tags';
import { accountLabel } from '../../core/utils/account-label';
import { TaxCodeComponent } from '../../core/tax/tax-code/tax-code.component';
import { effectiveTaxSection, type EffectiveTaxSection } from '../../core/tax/tax-sections';
import { TaxSectionsService } from '../../core/services/tax-sections.service';
import { TaxTagsService } from '../../core/services/tax-tags.service';
import { TranslationService } from '../../core/services/translation.service';
import { toCssColor } from '../../core/utils/category-color';
import { TableDensityService } from '../../core/services/table-density.service';
import { DensityPickerComponent } from '../../shared/components/density-picker/density-picker.component';
import { RibbonBandDirective } from '../../shared/components/ribbon/ribbon-band.directive';
import { RibbonGroupComponent } from '../../shared/components/ribbon/ribbon-group.component';
import { RibbonHost } from '../../shared/components/ribbon/ribbon-host';
import { RibbonComponent } from '../../shared/components/ribbon/ribbon.component';
import { DataTableToolbarOutlet } from '../../shared/components/data-table/data-table-toolbar-outlet';
import { DataTableCellDirective } from '../../shared/components/data-table/data-table-cell.directive';
import { DataTableComponent } from '../../shared/components/data-table/data-table.component';
import {
  colDef,
  type DataTableColDef,
  type DataTableMenuItem,
  type DataTableOptions,
} from '../../shared/components/data-table/data-table.model';
import { ColorCellComponent } from './cells/color-cell/color-cell.component';
import { CategoryDialogs } from './category-dialogs';
import { CategoriesStore } from './categories.store';
import { TaxSectionDialogs } from './tax-section-dialog/tax-section-dialogs';

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
  imports: [
    CdkPortalOutlet,
    DataTableComponent,
    DataTableCellDirective,
    ColorCellComponent,
    TaxCodeComponent,
    DensityPickerComponent,
    RibbonBandDirective,
    RibbonComponent,
    RibbonGroupComponent,
  ],
  providers: [
    CategoriesStore,
    CategoryDialogs,
    TaxSectionDialogs,
    RibbonHost,
    DataTableToolbarOutlet,
  ],
})
export class CategoriesComponent {
  protected readonly i18n = inject(TranslationService);
  protected readonly store = inject(CategoriesStore);
  protected readonly densities = inject(TableDensityService);
  protected readonly taxSectionDialogs = inject(TaxSectionDialogs);
  private readonly categoryDialogs = inject(CategoryDialogs);
  private readonly taxTags = inject(TaxTagsService);
  private readonly taxSections = inject(TaxSectionsService);

  /**
   * Each category's effective tax section, recomputed when the categories, tags or sections
   * change; `null` until the tags and sections are loaded.
   */
  private readonly taxByCategoryId: Signal<ReadonlyMap<number, EffectiveTaxSection> | null> =
    computed((): ReadonlyMap<number, EffectiveTaxSection> | null => {
      const tags: ReadonlyMap<number, TaxTagCode> | null = this.taxTags.tags();
      const sections: readonly TaxSection[] | null = this.taxSections.sections();
      if (tags === null || sections === null) return null;
      const sectionsByCode: ReadonlyMap<string, TaxSection> = new Map<string, TaxSection>(
        sections.map((s: TaxSection): [string, TaxSection] => [s.code, s]),
      );
      const categories: readonly CategoryRow[] = this.store.categories();
      const byId: ReadonlyMap<number, CategoryRow> = new Map<number, CategoryRow>(
        categories.map((c: CategoryRow): [number, CategoryRow] => [c.id, c]),
      );
      return new Map<number, EffectiveTaxSection>(
        categories.map((c: CategoryRow): [number, EffectiveTaxSection] => [
          c.id,
          effectiveTaxSection({ category: c, byId, tags, sections: sectionsByCode }),
        ]),
      );
    });

  /** The tax tags or sections could not be loaded; the "Tax section" column stays empty. */
  protected readonly taxError: WritableSignal<boolean> = signal<boolean>(false);

  /** The table shows its loading state until the tax tags and sections are loaded too. */
  protected readonly taxPending: Signal<boolean> = computed(
    (): boolean =>
      (this.taxTags.tags() === null || this.taxSections.sections() === null) && !this.taxError(),
  );

  protected readonly search: WritableSignal<string> = signal<string>('');
  protected readonly searchActive: Signal<boolean> = computed((): boolean => this.search() !== '');
  protected readonly searchState: Signal<string | null> = computed((): string | null =>
    this.searchActive() ? `"${this.search()}"` : null,
  );
  private readonly toolbarOutlet = viewChild(CdkPortalOutlet);

  constructor() {
    const tableToolbar: DataTableToolbarOutlet = inject(DataTableToolbarOutlet);
    effect((): void => tableToolbar.outlet.set(this.toolbarOutlet()));
    const destroyRef: DestroyRef = inject(DestroyRef);
    const onError = (cause: unknown): void => {
      this.taxError.set(true);
      throw cause;
    };
    if (this.taxTags.tags() === null) {
      this.taxTags.load().pipe(takeUntilDestroyed(destroyRef)).subscribe({ error: onError });
    }
    if (this.taxSections.sections() === null) {
      this.taxSections.load().pipe(takeUntilDestroyed(destroyRef)).subscribe({ error: onError });
    }
  }

  protected onSearchInput(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  // Lookups and translations are lambdas evaluated live (they read signals when the table calls
  // them), so the array itself is built once.
  protected readonly columns: readonly DataTableColDef<CategoryRow>[] = [
    { colId: 'name', headerKey: 'categories.colName' },
    { colId: 'nummer', headerKey: 'categories.colNumber' },
    colDef<CategoryRow, string | null>({
      colId: 'taxSection',
      headerKey: 'categories.colTaxSection',
      valueGetter: (row) => this.taxSectionLabel(row),
      cellRenderer: 'taxSection',
    }),
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
      valueGetter: (row) => this.rowAccountLabel(row),
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
    // Edit only: the page has no transaction to prefill a new category from.
    getContextMenuItems: ({ row }): readonly DataTableMenuItem[] => [
      {
        nameKey: 'categories.menuEdit',
        action: (): void => this.categoryDialogs.openEdit(this.store, row),
      },
    ],
  };

  /** The effective tax section of `row` for the cell template; `null` while the tags load. */
  protected taxOf(row: CategoryRow): EffectiveTaxSection | null {
    const byId: ReadonlyMap<number, EffectiveTaxSection> | null = this.taxByCategoryId();
    if (byId === null) return null;
    const tax: EffectiveTaxSection | undefined = byId.get(row.id);
    if (!tax) throw new Error(`category ${row.id} has no tax section entry`);
    return tax;
  }

  protected sectionName(tax: EffectiveTaxSection): string {
    if (!tax.section) throw new Error('no section to name');
    return tax.section.name;
  }

  // `DataTableCellContext.value` is `unknown`; the "color" renderer is only wired to the `color`
  // column, whose value is `string | null`. Anything else means a mis-wired column.
  protected asCssColor(value: unknown): string | null {
    if (value === null || typeof value === 'string') return value;
    throw new Error(`color cell expects string | null, got ${typeof value}`);
  }

  /**
   * The text the table sorts and filters the tax column by: the section code and name, "Not
   * tax-relevant" for St-0, null (a dash) when nothing is tagged on the chain.
   */
  private taxSectionLabel(row: CategoryRow): string | null {
    const tax: EffectiveTaxSection | null = this.taxOf(row);
    if (tax === null) return null;
    if (tax.section) return `${tax.section.code} ${this.sectionName(tax)}`;
    return tax.sourceCategoryId === null ? null : this.i18n.t('tax.section.excluded');
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

  private rowAccountLabel(row: CategoryRow): string | null {
    if (row.konto_id === null) return null;
    const account: AccountRow | undefined = this.store.accountsById().get(row.konto_id);
    if (!account) throw new Error(`category ${row.id}: account ${row.konto_id} is not loaded`);
    return accountLabel(account);
  }
}
