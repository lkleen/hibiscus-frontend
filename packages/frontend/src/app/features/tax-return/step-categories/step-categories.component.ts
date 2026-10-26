import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
  type Signal,
} from '@angular/core';
import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import type { TaxTagCode } from '@hibiscus-frontend/shared/contracts/tax-tags';
import type { TaxSituation } from '@hibiscus-frontend/shared/contracts/user-settings';
import type { TranslationKey } from '../../../core/models/translation.model';
import { LocaleService } from '../../../core/services/locale.service';
import { TranslationService } from '../../../core/services/translation.service';
import { TaxCodeComponent } from '../../../core/tax/tax-code/tax-code.component';
import {
  TaxSectionPickerComponent,
  type TaxSectionPickerOption,
} from '../../../core/tax/tax-section-picker/tax-section-picker.component';
import { taxKey, taxPlainDescription, taxSectionDescription } from '../../../core/tax/tax-i18n';
import {
  TAX_EXCLUDED_CODE,
  TAX_SECTIONS,
  type EffectiveTaxSection,
  type TaxSection,
  type TaxSuggestion,
} from '../../../core/tax/tax-sections';
import { DataTableCellDirective } from '../../../shared/components/data-table/data-table-cell.directive';
import { DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import {
  colDef,
  type DataTableColDef,
  type DataTableOptions,
} from '../../../shared/components/data-table/data-table.model';
import { AmountCellComponent } from '../../transactions/cells/amount-cell/amount-cell.component';
import { formatEuro } from '../tax-euro.pipe';
import {
  TaxReturnStore,
  type TaxSituations,
  type TaxTagSaveProblem,
  type TaxYearStats,
} from '../tax-return.store';
import type { TaxStep } from '../wizard/tax-step';
import { TaxGuidanceComponent } from './tax-guidance.component';

/** The life-situation questions, in the order they are asked. */
const SITUATIONS: readonly { readonly id: TaxSituation; readonly key: TranslationKey }[] = [
  { id: 'employed', key: 'tax.situation.employed' },
  { id: 'children', key: 'tax.situation.children' },
  { id: 'household', key: 'tax.situation.household' },
  { id: 'rental', key: 'tax.situation.rental' },
  { id: 'donations', key: 'tax.situation.donations' },
];

/** Every code the picker offers, to turn a picked value back into a tag. */
const PICKER_CODES: readonly TaxTagCode[] = [
  ...TAX_SECTIONS.map((section: TaxSection): TaxTagCode => section.code),
  TAX_EXCLUDED_CODE,
];

/** Which categories the tree lists. */
type TreeScope = 'year' | 'all' | 'review';

/**
 * Step ①: identify the tax-relevant categories. The life situation switches sections on or off,
 * suggestions propose a section by keyword, and the category tree has a section picker per row.
 * Every change only goes into the draft; "Save tags" saves all pending changes at once. In a later
 * year (tags exist), the step opens collapsed to a summary.
 */
@Component({
  selector: 'app-tax-step-categories',
  templateUrl: './step-categories.component.html',
  styleUrls: ['../tax-ui.scss', './step-categories.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DataTableComponent,
    DataTableCellDirective,
    AmountCellComponent,
    TaxCodeComponent,
    TaxSectionPickerComponent,
    TaxGuidanceComponent,
  ],
})
export class StepCategoriesComponent {
  protected readonly i18n = inject(TranslationService);
  protected readonly store = inject(TaxReturnStore);
  private readonly locale = inject(LocaleService).locale;

  /** Asks the wizard to show another step. */
  readonly go = output<TaxStep>();

  protected readonly situations = SITUATIONS;

  /** Later years open collapsed; the user expands to review. */
  protected readonly expanded = signal<boolean>(!this.store.hasTags());
  protected readonly scope = signal<TreeScope>('year');
  protected readonly selectedRowId = signal<string | number | null>(null);

  protected readonly year: Signal<number> = computed((): number => this.store.report().year);

  protected readonly answers: Signal<TaxSituations | null> = this.store.situations;

  // --- Suggestions --------------------------------------------------------------------------

  protected readonly suggestionColumns: readonly DataTableColDef<TaxSuggestion>[] = [
    colDef<TaxSuggestion, string>({
      colId: 'category',
      headerKey: 'tax.suggestions.colCategory',
      valueGetter: (s) => this.pathOf(s.category.id),
      filter: false,
    }),
    colDef<TaxSuggestion, number>({
      colId: 'sum',
      headerKey: 'tax.suggestions.colSum',
      valueGetter: (s) => this.netOf(s.category.id),
      cellRenderer: 'amount',
      align: 'end',
      filter: false,
    }),
    colDef<TaxSuggestion, string>({
      colId: 'section',
      headerKey: 'tax.suggestions.colSection',
      valueGetter: (s) => this.i18n.t(taxKey(s.section.nameKey)),
      cellRenderer: 'suggestedSection',
      filter: false,
    }),
    colDef<TaxSuggestion, null>({
      colId: 'actions',
      headerKey: 'tax.suggestions.colActions',
      valueGetter: () => null,
      cellRenderer: 'suggestionActions',
      sortable: false,
      filter: false,
    }),
  ];

  protected readonly suggestionOptions: DataTableOptions<TaxSuggestion> = {
    getRowId: (s) => s.category.id,
    defaultSort: [{ colId: 'category', order: 1 }],
    quickFilter: false,
    scrollHeight: false,
    columnReorder: false,
    pagination: { pageSize: 10, pageSizes: [10, 20, 50] },
    emptyKey: 'tax.suggestions.empty',
  };

  // --- Category tree ------------------------------------------------------------------------

  protected readonly treeColumns: readonly DataTableColDef<CategoryRow>[] = [
    { colId: 'name', headerKey: 'tax.tree.colCategory' },
    colDef<CategoryRow, number>({
      colId: 'count',
      headerKey: 'tax.tree.colCount',
      valueGetter: (row) => this.statsOf(row.id)?.count ?? 0,
      align: 'end',
      filter: false,
    }),
    colDef<CategoryRow, number>({
      colId: 'income',
      headerKey: 'tax.tree.colIncome',
      valueGetter: (row) => this.statsOf(row.id)?.income ?? 0,
      valueFormatter: (value) => formatEuro(value, this.locale()),
      align: 'end',
      filter: false,
    }),
    colDef<CategoryRow, number>({
      colId: 'expenses',
      headerKey: 'tax.tree.colExpenses',
      valueGetter: (row) => this.statsOf(row.id)?.expenses ?? 0,
      valueFormatter: (value) => formatEuro(value, this.locale()),
      align: 'end',
      filter: false,
    }),
    colDef<CategoryRow, string | null>({
      colId: 'section',
      headerKey: 'tax.tree.colSection',
      valueGetter: (row) => this.store.effectiveDraft(row.id).section?.code ?? null,
      cellRenderer: 'sectionPicker',
      sortable: false,
      filter: false,
    }),
    { colId: 'id', hide: true, filter: false },
  ];

  protected readonly treeOptions: DataTableOptions<CategoryRow> = {
    treeData: { getParentId: (row) => row.parent_id, groupColId: 'name' },
    getRowId: (row) => row.id,
    rowSelection: { mode: 'single' },
    defaultSort: [
      { colId: 'name', order: 1 },
      { colId: 'id', order: 1 },
    ],
    autoSizeStrategy: { type: 'fitGridWidth' },
    scrollHeight: '32rem',
    emptyKey: 'tax.tree.empty',
  };

  /** The tree's rows: the categories in scope plus their ancestors, so the tree stays whole. */
  protected readonly treeRows: Signal<readonly CategoryRow[]> = computed(
    (): readonly CategoryRow[] => {
      const categories: readonly CategoryRow[] = this.store.transactions.categories();
      const scope: TreeScope = this.scope();
      if (scope === 'all') return categories;
      const matches: readonly number[] =
        scope === 'review'
          ? this.store.reviewCategories().map((c: CategoryRow): number => c.id)
          : [...this.store.yearStats().keys()];
      const byId: ReadonlyMap<number, CategoryRow> = new Map(
        categories.map((c: CategoryRow): [number, CategoryRow] => [c.id, c]),
      );
      const included: Set<number> = new Set<number>();
      for (const id of matches) {
        let current: CategoryRow | undefined = byId.get(id);
        while (current !== undefined && !included.has(current.id)) {
          included.add(current.id);
          current = current.parent_id === null ? undefined : byId.get(current.parent_id);
        }
      }
      return categories.filter((c: CategoryRow): boolean => included.has(c.id));
    },
  );

  /** The selected row's category, or `null`. */
  private readonly selected: Signal<CategoryRow | null> = computed((): CategoryRow | null => {
    const id: string | number | null = this.selectedRowId();
    if (id === null) return null;
    return (
      this.store.transactions.categories().find((c: CategoryRow): boolean => c.id === id) ?? null
    );
  });

  protected readonly selectedName: Signal<string | null> = computed(
    (): string | null => this.selected()?.name ?? null,
  );

  protected readonly selectedEffective: Signal<EffectiveTaxSection | null> = computed(
    (): EffectiveTaxSection | null => {
      const category: CategoryRow | null = this.selected();
      return category === null ? null : this.store.effectiveDraft(category.id);
    },
  );

  protected readonly pendingCount: Signal<number> = computed(
    (): number => this.store.pendingDraft().size,
  );

  /** The last "Save tags" failure as text; conflicts name the categories. */
  protected readonly saveMessage: Signal<string | null> = computed((): string | null => {
    const problem: TaxTagSaveProblem | null = this.store.saveProblem();
    if (problem === null) return null;
    if (problem.kind === 'error') return this.i18n.t('tax.tree.saveError');
    const byId: ReadonlyMap<number, CategoryRow> = new Map<number, CategoryRow>(
      this.store.transactions
        .categories()
        .map((c: CategoryRow): [number, CategoryRow] => [c.id, c]),
    );
    // A category deleted elsewhere is no longer loaded; its id is all there is to name.
    const names: string = problem.categoryIds
      .map((id: number): string => byId.get(id)?.name ?? `#${id}`)
      .join(', ');
    return this.i18n.t('tax.tree.saveConflict', { names });
  });

  // --- Situation ----------------------------------------------------------------------------

  protected answer(id: TaxSituation, value: boolean): void {
    this.store.answer(id, value);
  }

  // --- Suggestions --------------------------------------------------------------------------

  protected accept(suggestion: TaxSuggestion): void {
    this.store.accept(suggestion);
  }

  protected reject(suggestion: TaxSuggestion): void {
    this.store.reject(suggestion);
  }

  protected acceptAll(): void {
    this.store.acceptAll();
  }

  // --- Tree ---------------------------------------------------------------------------------

  protected onOnlyYearChange(event: Event): void {
    const target: EventTarget | null = event.target;
    if (!(target instanceof HTMLInputElement)) throw new Error('expected a checkbox');
    this.scope.set(target.checked ? 'year' : 'all');
  }

  protected review(): void {
    this.expanded.set(true);
    this.scope.set('review');
  }

  protected showYear(): void {
    this.scope.set('year');
  }

  /** The value the row's picker shows: the draft or stored own tag; '' for none (inherit). */
  protected pickerValue(row: CategoryRow): TaxTagCode | '' {
    return this.store.draftTagOf(row.id) ?? '';
  }

  /** `''` (no own tag) leads; the others are the sections and "not tax-relevant". */
  protected pickerOptions(row: CategoryRow): readonly TaxSectionPickerOption[] {
    const effective: EffectiveTaxSection = this.store.effectiveDraft(row.id);
    const inheritedCode: string | null = effective.inherited ? this.codeOf(effective) : null;
    const inherit: TaxSectionPickerOption =
      inheritedCode === null
        ? {
            value: '',
            label: this.i18n.t('tax.tree.none'),
            code: null,
            description: taxPlainDescription(this.i18n.t('tax.picker.noneDescription')),
          }
        : {
            value: '',
            label: this.i18n.t('tax.tree.inherit', { code: inheritedCode }),
            code: null,
            description: taxPlainDescription(
              this.i18n.t('tax.picker.inheritDescription', { code: inheritedCode }),
            ),
            inherited: true,
          };
    return [
      inherit,
      ...TAX_SECTIONS.map((section: TaxSection): TaxSectionPickerOption => ({
        value: section.code,
        label: this.i18n.t(taxKey(section.nameKey)),
        code: section.code,
        description: taxSectionDescription(this.i18n, section),
      })),
      {
        value: TAX_EXCLUDED_CODE,
        label: this.i18n.t('tax.section.excluded'),
        code: TAX_EXCLUDED_CODE,
        description: taxPlainDescription(this.i18n.t('tax.picker.excludedDescription')),
      },
    ];
  }

  protected isInherited(row: CategoryRow): boolean {
    return this.pickerValue(row) === '' && this.store.effectiveDraft(row.id).inherited;
  }

  protected isPending(row: CategoryRow): boolean {
    return this.store.pendingDraft().has(row.id);
  }

  protected onPick(row: CategoryRow, value: string): void {
    if (value === '') {
      this.store.setDraft(row.id, null);
      return;
    }
    const code: TaxTagCode | undefined = PICKER_CODES.find((c: TaxTagCode): boolean => c === value);
    if (code === undefined) throw new Error(`unknown tax tag "${value}"`);
    this.store.setDraft(row.id, code);
  }

  protected discard(): void {
    this.store.discardDraft();
  }

  protected saveTags(): void {
    this.store.saveTags();
  }

  // --- Cells --------------------------------------------------------------------------------

  protected asAmount(value: unknown): number {
    if (typeof value === 'number') return value;
    throw new Error(`amount cell expects a number, got ${typeof value}`);
  }

  protected asCategory(row: unknown): CategoryRow {
    if (typeof row === 'object' && row !== null && 'nummer' in row) return row as CategoryRow;
    throw new Error('section picker expects a category row');
  }

  protected asSuggestion(row: unknown): TaxSuggestion {
    if (typeof row === 'object' && row !== null && 'section' in row) return row as TaxSuggestion;
    throw new Error('expected a suggestion row');
  }

  protected sectionNameKey(section: TaxSection): TranslationKey {
    return taxKey(section.nameKey);
  }

  private codeOf(effective: EffectiveTaxSection): string | null {
    if (effective.section !== null) return effective.section.code;
    return effective.sourceCategoryId === null ? null : TAX_EXCLUDED_CODE;
  }

  private statsOf(id: number): TaxYearStats | undefined {
    return this.store.yearStats().get(id);
  }

  private netOf(id: number): number {
    const stats: TaxYearStats | undefined = this.statsOf(id);
    return stats === undefined ? 0 : stats.income - stats.expenses;
  }

  private pathOf(id: number): string {
    const path: string | undefined = this.store.transactions.categoryPathsById().get(id);
    if (path === undefined) throw new Error(`category ${id} has no path`);
    return path;
  }
}
