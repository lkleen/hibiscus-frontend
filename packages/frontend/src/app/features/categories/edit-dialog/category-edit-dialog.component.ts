import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  type Signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type {
  CategoryEditableFields,
  CategoryRow,
} from '@hibiscus-frontend/shared/contracts/categories';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import type {
  TaxSection,
  TaxTagCode,
  TaxTagUpdate,
} from '@hibiscus-frontend/shared/contracts/tax-tags';
import { debounceTime } from 'rxjs';
import { TaxSectionsService } from '../../../core/services/tax-sections.service';
import { TaxTagsService } from '../../../core/services/tax-tags.service';
import { TranslationService } from '../../../core/services/translation.service';
import { accountLabel } from '../../../core/utils/account-label';
import { TAX_EXCLUDED_CODE, effectiveTaxSection } from '../../../core/tax/tax-sections';
import {
  taxPlainDescription,
  taxSectionDescription,
  type TaxDescription,
} from '../../../core/tax/tax-i18n';
import { TaxDescriptionComponent } from '../../../core/tax/tax-description/tax-description.component';
import { toHexColor, toStoredColor } from '../../../core/utils/category-color';
import {
  assignCategories,
  compileCategory,
  matchesCategory,
  type CategoryAssignment,
} from '../../../core/utils/category-matching';
import { DataTableCellDirective } from '../../../shared/components/data-table/data-table-cell.directive';
import { DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import {
  colDef,
  type DataTableColDef,
  type DataTableOptions,
} from '../../../shared/components/data-table/data-table.model';
import { APP_DIALOG_CLASS } from '../../../shared/dialog/dialog-classes';
import { AmountCellComponent } from '../../transactions/cells/amount-cell/amount-cell.component';
import { CategoryPickerComponent } from '../../transactions/category-picker/category-picker.component';
import {
  editableFieldsOf,
  toCategorySaveError,
  type CategoryEditDialogData,
  type CategoryEditSource,
  type CategorySave,
  type CategorySaveError,
} from './category-edit-dialog.model';

/** The `ariaLabelledBy` target of the dialog. */
export const CATEGORY_EDIT_TITLE_ID = 'category-edit-title';
/** The name input; the opener focuses it when the dialog opens. */
export const CATEGORY_EDIT_NAME_ID = 'category-edit-name';

/** Hibiscus `umsatztyp.flags` bit 1 (`FLAG_SKIP_REPORTS`). */
const FLAG_SKIP_REPORTS = 1;
const TYPE_EXPENSE = 0;
const TYPE_INCOME = 1;
const TYPE_ANY = 2;
/** The id of a category that is not stored yet. */
const NEW_CATEGORY_ID = -1;
const DEBOUNCE_MS = 300;
/** `<input type="color">` needs a value; shown while a category has no colour. */
const FALLBACK_COLOR = '#808080';

type TypeChoice = 'any' | 'expense' | 'income';

export type PreviewStatus = 'assignedHere' | 'storedHere' | 'storedElsewhere' | 'claimed';

/** A transaction the draft pattern matches, and what becomes of it. */
export interface PreviewRow {
  readonly transaction: TransactionRow;
  readonly status: PreviewStatus;
  /** The other category's path for `storedElsewhere` and `claimed`; else `null`. */
  readonly otherPath: string | null;
}

type Preview =
  | { readonly kind: 'ready'; readonly rows: readonly PreviewRow[] }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'noPattern' };

/** The `<select>` value of "as parent category" (no tag of its own). */
const TAX_INHERIT = '';

const NO_ROWS: readonly PreviewRow[] = [];

/** A nullable text field is stored as NULL when empty. */
function nullIfEmpty(value: string | null): string | null {
  return value === null || value.trim() === '' ? null : value;
}

function typeChoiceOf(umsatztyp: number | null): TypeChoice {
  if (umsatztyp === TYPE_EXPENSE) return 'expense';
  if (umsatztyp === TYPE_INCOME) return 'income';
  return 'any';
}

/** What the form shows for the stored values; an untouched form must reproduce them. */
function normalizeFields(fields: CategoryEditableFields): CategoryEditableFields {
  return {
    ...fields,
    name: fields.name.trim(),
    nummer: nullIfEmpty(fields.nummer),
    pattern: nullIfEmpty(fields.pattern),
    kommentar: nullIfEmpty(fields.kommentar),
    konto_kategorie: nullIfEmpty(fields.konto_kategorie),
  };
}

function sameFields(a: CategoryEditableFields, b: CategoryEditableFields): boolean {
  return (Object.keys(a) as (keyof CategoryEditableFields)[]).every(
    (key: keyof CategoryEditableFields) => a[key] === b[key],
  );
}

function descendantIds(categories: readonly CategoryRow[], rootId: number): Set<number> {
  const found = new Set<number>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const category of categories) {
      if (category.parent_id !== null && found.has(category.parent_id) && !found.has(category.id)) {
        found.add(category.id);
        grew = true;
      }
    }
  }
  return found;
}

/**
 * Creates or edits a category (Hibiscus `umsatztyp`), with a live preview of the transactions its
 * pattern matches. Nothing is saved until Create / Apply. The preview recomputes 300 ms after the
 * last keystroke; the validity of the pattern is checked immediately.
 */
@Component({
  selector: 'app-category-edit-dialog',
  templateUrl: './category-edit-dialog.component.html',
  styleUrl: './category-edit-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: APP_DIALOG_CLASS },
  imports: [
    CategoryPickerComponent,
    DataTableComponent,
    DataTableCellDirective,
    AmountCellComponent,
    TaxDescriptionComponent,
  ],
})
export class CategoryEditDialogComponent {
  protected readonly i18n = inject(TranslationService);
  private readonly data: CategoryEditDialogData = inject<CategoryEditDialogData>(DIALOG_DATA);
  /** Closes with the saved category as stored; with nothing on cancel. */
  private readonly dialogRef: DialogRef<CategoryRow, CategoryEditDialogComponent> =
    inject<DialogRef<CategoryRow, CategoryEditDialogComponent>>(DialogRef);
  private readonly destroyed = signal<boolean>(false);
  private readonly taxTags = inject(TaxTagsService);
  private readonly taxSections = inject(TaxSectionsService);
  private readonly source: CategoryEditSource = this.data.source;

  protected readonly isEdit: boolean = this.data.mode === 'edit';
  private readonly editedId: number =
    this.data.mode === 'edit' ? this.data.category.id : NEW_CATEGORY_ID;
  /** The values the dialog started from; "unchanged" is measured against these. */
  private readonly initial: CategoryEditableFields = ((): CategoryEditableFields => {
    if (this.data.mode === 'create') return this.data.initial;
    return editableFieldsOf(this.data.category);
  })();
  private readonly baseline: CategoryEditableFields = normalizeFields(this.initial);
  private readonly initialHex: string | null = toHexColor(this.initial.color);

  protected readonly titleId: string = CATEGORY_EDIT_TITLE_ID;
  protected readonly nameId: string = CATEGORY_EDIT_NAME_ID;
  protected readonly patternErrorId: string = 'category-edit-pattern-error';
  protected readonly taxId: string = 'category-edit-tax';
  protected readonly taxDescriptionId: string = 'category-edit-tax-description';
  protected readonly taxInherit: string = TAX_INHERIT;
  protected readonly taxExcluded: string = TAX_EXCLUDED_CODE;

  protected readonly name = signal<string>(this.initial.name);
  protected readonly parentId = signal<number | null>(this.initial.parent_id);
  protected readonly pattern = signal<string>(this.initial.pattern ?? '');
  protected readonly isRegex = signal<boolean>(this.initial.isregex === 1);
  protected readonly typeChoice = signal<TypeChoice>(typeChoiceOf(this.initial.umsatztyp));
  protected readonly accountId = signal<number | null>(this.initial.konto_id);
  protected readonly accountCategory = signal<string>(this.initial.konto_kategorie ?? '');
  protected readonly number = signal<string>(this.initial.nummer ?? '');
  protected readonly customColor = signal<boolean>(this.initial.customcolor === 1);
  protected readonly colorHex = signal<string>(this.initialHex ?? FALLBACK_COLOR);
  protected readonly comment = signal<string>(this.initial.kommentar ?? '');
  protected readonly skipReports = signal<boolean>(
    ((this.initial.flags ?? 0) & FLAG_SKIP_REPORTS) !== 0,
  );

  /**
   * The tag stored when the dialog opened, captured once as soon as the tags are known (`undefined`
   * until then). The update's `expected`, so a change made meanwhile is a 409.
   */
  private readonly openedTag = signal<TaxTagCode | null | undefined>(undefined);
  /** The user's pick (`''` = as parent); `null` = untouched, which shows the opened tag. */
  private readonly taxPick = signal<string | null>(null);

  /** The `<select>` value: `''` (as parent), `'St-0'` or a section code. */
  protected readonly taxChoice = computed<string>(
    () => this.taxPick() ?? this.openedTag() ?? TAX_INHERIT,
  );
  protected readonly taxLoading = computed<boolean>(
    () => this.openedTag() === undefined || this.taxSections.sections() === null,
  );
  protected readonly taxSectionList = computed<readonly TaxSection[]>(
    () => this.taxSections.sections() ?? [],
  );

  /** What the chosen parent resolves to; `null` section with `excluded` false = nothing applies. */
  private readonly inherited = computed<{ section: TaxSection | null; excluded: boolean }>(() => {
    const tags: ReadonlyMap<number, TaxTagCode> | null = this.taxTags.tags();
    const sections: readonly TaxSection[] | null = this.taxSections.sections();
    const parentId: number | null = this.parentId();
    if (tags === null || sections === null || parentId === null) {
      return { section: null, excluded: false };
    }
    const byId: ReadonlyMap<number, CategoryRow> = new Map<number, CategoryRow>(
      this.source.categories().map((c: CategoryRow): [number, CategoryRow] => [c.id, c]),
    );
    const parent: CategoryRow | undefined = byId.get(parentId);
    if (parent === undefined) throw new Error(`parent category ${parentId} is not loaded`);
    const effective: ReturnType<typeof effectiveTaxSection> = effectiveTaxSection({
      category: parent,
      byId,
      tags,
      sections: new Map<string, TaxSection>(
        sections.map((s: TaxSection): [string, TaxSection] => [s.code, s]),
      ),
    });
    return {
      section: effective.section,
      excluded: effective.section === null && effective.sourceCategoryId !== null,
    };
  });

  protected readonly taxInheritLabel = computed<string>(() => {
    const inherited: { section: TaxSection | null; excluded: boolean } = this.inherited();
    if (inherited.section !== null) {
      return this.i18n.t('categories.edit.taxInherit', {
        section: this.sectionLabel(inherited.section),
      });
    }
    return this.i18n.t('categories.edit.taxInherit', {
      section: this.i18n.t(inherited.excluded ? 'tax.section.excluded' : 'categories.edit.taxNone'),
    });
  });

  protected readonly taxDescription = computed<TaxDescription>(() => {
    const choice: string = this.taxChoice();
    if (choice === TAX_EXCLUDED_CODE) {
      return taxPlainDescription(this.i18n.t('categories.edit.taxExcludedHint'));
    }
    if (choice === TAX_INHERIT) {
      const inherited: { section: TaxSection | null; excluded: boolean } = this.inherited();
      if (inherited.section !== null) return taxSectionDescription(inherited.section);
      return taxPlainDescription(
        this.i18n.t(
          inherited.excluded ? 'categories.edit.taxExcludedHint' : 'categories.edit.taxNoneHint',
        ),
      );
    }
    const section: TaxSection | undefined = this.taxSectionList().find(
      (s: TaxSection): boolean => s.code === choice,
    );
    if (section === undefined) throw new Error(`unknown tax section "${choice}"`);
    return taxSectionDescription(section);
  });

  /** The tag the form would save. */
  private readonly nextTag = computed<TaxTagCode | null>(() => {
    const choice: string = this.taxChoice();
    return choice === TAX_INHERIT ? null : choice;
  });

  protected readonly saving = signal<boolean>(false);
  protected readonly error = signal<CategorySaveError | null>(null);

  protected readonly accounts: Signal<readonly AccountRow[]> = this.source.accounts;
  protected readonly typeChoices: readonly TypeChoice[] = ['any', 'expense', 'income'];

  /** The categories a parent may be picked from: in edit mode without the category and its subtree. */
  protected readonly parentCandidates = computed<readonly CategoryRow[]>(() => {
    const categories: readonly CategoryRow[] = this.source.categories();
    if (!this.isEdit) return categories;
    const excluded: Set<number> = descendantIds(categories, this.editedId);
    return categories.filter((category: CategoryRow) => !excluded.has(category.id));
  });

  protected readonly parentLabel = computed<string>(() => {
    const id: number | null = this.parentId();
    if (id === null) return this.i18n.t('categories.edit.noParent');
    return this.source.categoryPathsById().get(id) ?? String(id);
  });

  /** The form as the fields that would be saved. */
  protected readonly draft = computed<CategoryEditableFields>(() => {
    const hex: string = this.colorHex();
    const regex: boolean = this.isRegex();
    const customColor: boolean = this.customColor();
    const skip: boolean = this.skipReports();
    const type: TypeChoice = this.typeChoice();
    const initial: CategoryEditableFields = this.initial;
    return {
      name: this.name().trim(),
      nummer: nullIfEmpty(this.number()),
      pattern: nullIfEmpty(this.pattern()),
      // A flag or colour the user did not touch keeps its stored value (NULL stays NULL).
      isregex: regex === (initial.isregex === 1) ? initial.isregex : regex ? 1 : 0,
      umsatztyp:
        type === typeChoiceOf(initial.umsatztyp)
          ? initial.umsatztyp
          : type === 'expense'
            ? TYPE_EXPENSE
            : type === 'income'
              ? TYPE_INCOME
              : TYPE_ANY,
      parent_id: this.parentId(),
      color:
        hex === (this.initialHex ?? FALLBACK_COLOR) && (initial.color !== null || !customColor)
          ? initial.color
          : toStoredColor(hex),
      customcolor:
        customColor === (initial.customcolor === 1) ? initial.customcolor : customColor ? 1 : 0,
      kommentar: nullIfEmpty(this.comment()),
      konto_id: this.accountId(),
      konto_kategorie: nullIfEmpty(this.accountCategory()),
      flags:
        skip === (((initial.flags ?? 0) & FLAG_SKIP_REPORTS) !== 0)
          ? initial.flags
          : skip
            ? (initial.flags ?? 0) | FLAG_SKIP_REPORTS
            : (initial.flags ?? 0) & ~FLAG_SKIP_REPORTS,
    };
  });

  protected readonly changed = computed<boolean>(
    () => !sameFields(this.draft(), this.baseline) || this.nextTag() !== this.openedTag(),
  );

  protected readonly patternInvalid = computed<boolean>(
    () => 'invalid' in compileCategory(this.toRow(this.draft())),
  );
  protected readonly hasPattern = computed<boolean>(() => this.draft().pattern !== null);

  protected readonly canSave = computed<boolean>(
    () =>
      this.draft().name !== '' &&
      (!this.isEdit || this.changed()) &&
      !this.patternInvalid() &&
      !this.saving() &&
      !this.taxLoading() &&
      this.error() !== 'conflict',
  );

  private readonly previewDraft: Signal<CategoryEditableFields> = toSignal(
    toObservable(this.draft).pipe(debounceTime(DEBOUNCE_MS)),
    { initialValue: this.draft() },
  );

  private readonly preview = computed<Preview>(() => this.buildPreview(this.previewDraft()));

  protected readonly rows = computed<readonly PreviewRow[]>(() => {
    const preview: Preview = this.preview();
    return preview.kind === 'ready' ? preview.rows : NO_ROWS;
  });

  protected readonly summary = computed<string>(() => {
    const rows: readonly PreviewRow[] = this.rows();
    const assigned: number = rows.filter(
      (row: PreviewRow) => row.status === 'assignedHere' || row.status === 'storedHere',
    ).length;
    return this.i18n.t('categories.edit.summary', { matching: rows.length, assigned });
  });

  protected readonly columns: readonly DataTableColDef<PreviewRow>[] = [
    colDef<PreviewRow, string>({
      colId: 'status',
      headerKey: 'categories.edit.colStatus',
      cellRenderer: 'status',
      valueGetter: (row: PreviewRow) => this.statusLabel(row),
    }),
    colDef<PreviewRow, string>({
      colId: 'valuta',
      headerKey: 'transactions.colValuta',
      filter: 'date',
      valueGetter: (row: PreviewRow) => row.transaction.valuta,
    }),
    colDef<PreviewRow, number>({
      colId: 'betrag',
      headerKey: 'transactions.colAmount',
      cellRenderer: 'amount',
      align: 'end',
      filter: 'numeric',
      valueGetter: (row: PreviewRow) => row.transaction.betrag,
    }),
    colDef<PreviewRow, string | null>({
      colId: 'empfaenger_name',
      headerKey: 'transactions.colRecipient',
      valueGetter: (row: PreviewRow) => row.transaction.empfaenger_name,
    }),
    colDef<PreviewRow, string | null>({
      colId: 'zweck',
      headerKey: 'transactions.colPurpose1',
      valueGetter: (row: PreviewRow) => row.transaction.zweck,
    }),
    colDef<PreviewRow, string>({
      colId: 'account',
      headerKey: 'transactions.colAccountLabel',
      valueGetter: (row: PreviewRow) => this.accountLabelOf(row.transaction),
    }),
    colDef<PreviewRow, string | null>({
      colId: 'stored',
      headerKey: 'transactions.colCategory',
      valueGetter: (row: PreviewRow) =>
        row.transaction.umsatztyp_id === null
          ? null
          : (this.source.categoryPathsById().get(row.transaction.umsatztyp_id) ?? null),
    }),
    {
      colId: 'id',
      hide: true,
      filter: false,
      valueGetter: (row: PreviewRow) => row.transaction.id,
    },
  ];

  protected readonly options: DataTableOptions<PreviewRow> = {
    getRowId: (row: PreviewRow) => row.transaction.id,
    defaultSort: [
      { colId: 'valuta', order: -1 },
      { colId: 'id', order: -1 },
    ],
    autoSizeStrategy: { type: 'fitCellContents' },
    scrollHeight: '20rem',
    emptyKey: 'categories.edit.previewEmpty',
  };

  constructor() {
    const destroyRef: DestroyRef = inject(DestroyRef);
    destroyRef.onDestroy((): void => this.destroyed.set(true));
    // The tag is saved with the category; the form needs the tags and the sections first.
    if (this.taxTags.tags() === null) {
      this.taxTags.load().pipe(takeUntilDestroyed(destroyRef)).subscribe();
    }
    if (this.taxSections.sections() === null) {
      this.taxSections.load().pipe(takeUntilDestroyed(destroyRef)).subscribe();
    }
    effect((): void => {
      const tags: ReadonlyMap<number, TaxTagCode> | null = this.taxTags.tags();
      if (tags === null || this.openedTag() !== undefined) return;
      this.openedTag.set(tags.get(this.editedId) ?? null);
    });
  }

  protected sectionLabel(section: TaxSection): string {
    return `${section.code} – ${section.name}`;
  }

  protected onTaxChange(event: Event): void {
    this.taxPick.set(this.valueOf(event));
  }

  protected typeLabelKey(
    choice: TypeChoice,
  ): 'categories.type.any' | 'categories.type.expense' | 'categories.type.income' {
    return `categories.type.${choice}`;
  }

  protected accountName(account: AccountRow): string {
    return accountLabel(account);
  }

  protected valueOf(event: Event): string {
    const target: EventTarget | null = event.target;
    if (!(
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    )) {
      throw new Error('expected a form control event');
    }
    return target.value;
  }

  protected checkedOf(event: Event): boolean {
    const target: EventTarget | null = event.target;
    if (!(target instanceof HTMLInputElement)) throw new Error('expected a checkbox event');
    return target.checked;
  }

  protected onAccountChange(event: Event): void {
    const value: string = this.valueOf(event);
    this.accountId.set(value === '' ? null : Number(value));
  }

  protected onTypeChange(event: Event): void {
    const value: string = this.valueOf(event);
    if (value !== 'any' && value !== 'expense' && value !== 'income') {
      throw new Error(`unknown type choice "${value}"`);
    }
    this.typeChoice.set(value);
  }

  protected onColorInput(event: Event): void {
    this.colorHex.set(this.valueOf(event));
    this.customColor.set(true);
  }

  protected clearParent(): void {
    this.parentId.set(null);
  }

  protected statusLabel(row: PreviewRow): string {
    if (row.status === 'storedElsewhere') {
      return this.i18n.t('categories.edit.status.storedElsewhere', { path: row.otherPath ?? '' });
    }
    if (row.status === 'claimed') {
      return this.i18n.t('categories.edit.status.claimed', { path: row.otherPath ?? '' });
    }
    return this.i18n.t(`categories.edit.status.${row.status}`);
  }

  // `DataTableCellContext` hands values and rows as `unknown`/`Row`; the renderers are only wired
  // to the `betrag` column (number) and the `status` column.
  protected asAmount(value: unknown): number | null {
    if (value === null || typeof value === 'number') return value;
    throw new Error(`amount cell expects number | null, got ${typeof value}`);
  }

  protected asText(value: unknown): string {
    if (typeof value === 'string') return value;
    throw new Error(`status cell expects a string, got ${typeof value}`);
  }

  protected cancel(): void {
    this.dialogRef.close();
  }

  protected save(): void {
    // A second click before the disabled button repaints.
    if (this.saving()) return;
    if (!this.canSave()) throw new Error('nothing to save');
    const fields: CategoryEditableFields = this.draft();
    const next: TaxTagCode | null = this.nextTag();
    const save: CategorySave =
      this.data.mode === 'create'
        ? { kind: 'create', fields, taxTag: next }
        : {
            kind: 'update',
            category: this.data.category,
            next: fields,
            taxTag: this.taxTagUpdate(next),
          };
    this.saving.set(true);
    this.error.set(null);
    // Escape and the backdrop must not close the dialog while the request is in flight, and the
    // subscription is deliberately not tied to this component: the store applies a confirmed save
    // even if the page went away first.
    this.dialogRef.disableClose = true;
    this.source.saveCategory(save).subscribe({
      next: (row: CategoryRow): void => {
        // Confirmed by the server, so it holds even if the dialog went away meanwhile.
        this.taxTags.applySaved(row.id, next);
        if (!this.destroyed()) this.dialogRef.close(row);
      },
      error: (cause: unknown): void => {
        if (this.destroyed()) return;
        this.dialogRef.disableClose = false;
        this.saving.set(false);
        this.error.set(toCategorySaveError(cause));
      },
    });
  }

  /** `expected` is the tag the dialog opened with, not the live one, so a concurrent change 409s. */
  private taxTagUpdate(next: TaxTagCode | null): TaxTagUpdate {
    const expected: TaxTagCode | null | undefined = this.openedTag();
    if (expected === undefined) throw new Error('tax tags are not loaded');
    return { expected, next };
  }

  private toRow(fields: CategoryEditableFields): CategoryRow {
    return { id: this.editedId, ...fields };
  }

  private accountLabelOf(transaction: TransactionRow): string {
    const account: AccountRow | undefined = this.source.accountsById().get(transaction.konto_id);
    if (!account) throw new Error(`account ${transaction.konto_id} is not loaded`);
    return accountLabel(account);
  }

  private buildPreview(fields: CategoryEditableFields): Preview {
    const draft: CategoryRow = this.toRow(fields);
    const compiled: ReturnType<typeof compileCategory> = compileCategory(draft);
    if ('invalid' in compiled) return { kind: 'invalid' };
    if (fields.pattern === null) return { kind: 'noPattern' };
    const accountsById: ReadonlyMap<number, AccountRow> = this.source.accountsById();
    const hits: TransactionRow[] = this.source.transactions().filter((t: TransactionRow) => {
      const account: AccountRow | undefined = accountsById.get(t.konto_id);
      if (!account) throw new Error(`account ${t.konto_id} of transaction ${t.id} is not loaded`);
      return matchesCategory(compiled, t, account);
    });
    const categories: CategoryRow[] = [
      ...this.source.categories().filter((c: CategoryRow) => c.id !== draft.id),
      draft,
    ];
    const assignment: CategoryAssignment = assignCategories({
      transactions: hits,
      categories,
      accountsById,
    });
    const paths: ReadonlyMap<number, string> = this.source.categoryPathsById();
    const pathOf = (id: number): string => paths.get(id) ?? String(id);
    const rows: PreviewRow[] = hits.map((transaction: TransactionRow): PreviewRow => {
      if (transaction.umsatztyp_id !== null) {
        return transaction.umsatztyp_id === draft.id
          ? { transaction, status: 'storedHere', otherPath: null }
          : {
              transaction,
              status: 'storedElsewhere',
              otherPath: pathOf(transaction.umsatztyp_id),
            };
      }
      const assigned: CategoryRow | null | undefined = assignment.byTransactionId.get(
        transaction.id,
      );
      if (!assigned) throw new Error(`transaction ${transaction.id} matched but was not assigned`);
      return assigned.id === draft.id
        ? { transaction, status: 'assignedHere', otherPath: null }
        : { transaction, status: 'claimed', otherPath: pathOf(assigned.id) };
    });
    return { kind: 'ready', rows };
  }
}
