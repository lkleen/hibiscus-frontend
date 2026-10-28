import { DialogRef } from '@angular/cdk/dialog';
import { hasModifierKey } from '@angular/cdk/keycodes';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
  type Signal,
  type WritableSignal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type {
  TaxSection,
  TaxSectionCode,
  TaxTagCode,
} from '@hibiscus-frontend/shared/contracts/tax-tags';
import { filter, map, type Observable } from 'rxjs';
import { TaxSectionsService } from '../../../core/services/tax-sections.service';
import { TaxTagsService } from '../../../core/services/tax-tags.service';
import type { TranslationKey } from '../../../core/models/translation.model';
import { TranslationService } from '../../../core/services/translation.service';
import { TaxCodeComponent } from '../../../core/tax/tax-code/tax-code.component';
import { APP_DIALOG_CLASS } from '../../../shared/dialog/dialog-classes';
import {
  EMPTY_DRAFT,
  GUIDANCE_FIELDS,
  TAX_SECTION_CODE_MAX_LENGTH,
  codeProblem,
  draftOf,
  sameSection,
  sectionOf,
  toTaxSectionRowError,
  type TaxSectionCodeProblem,
  type TaxSectionDraft,
  type TaxSectionDraftField,
  type TaxSectionRowError,
} from './tax-section-dialog.model';

/** The `ariaLabelledBy` target of the dialog. */
export const TAX_SECTION_DIALOG_TITLE_ID = 'tax-section-dialog-title';

/** The row key of the unsaved new section; never a valid code (no NUL in codes). */
const NEW_KEY = '\u0000new';

/** The row being edited: an existing section (as the edit started from it) or a new one. */
type OpenRow =
  | { readonly kind: 'none' }
  | { readonly kind: 'existing'; readonly original: TaxSection }
  | { readonly kind: 'new' };

/** What the user asked for while the open row has unsaved changes; waits for "Discard". */
type PendingAction =
  | { readonly kind: 'open'; readonly code: TaxSectionCode }
  | { readonly kind: 'new' }
  | { readonly kind: 'collapse' }
  | { readonly kind: 'close' };

interface RowView {
  readonly key: string;
  /** `null` for the new, unsaved section. */
  readonly section: TaxSection | null;
  readonly open: boolean;
}

const NONE: OpenRow = { kind: 'none' };

const FIELD_LABEL_KEYS: Readonly<Record<TaxSectionDraftField, TranslationKey>> = {
  code: 'categories.taxSections.code',
  name: 'categories.taxSections.name',
  form: 'categories.taxSections.form',
  belongs: 'categories.taxSections.belongs',
  excludes: 'categories.taxSections.excludes',
  receipts: 'categories.taxSections.receipts',
  note: 'categories.taxSections.note',
};

const CODE_PROBLEM_KEYS: Readonly<Record<TaxSectionCodeProblem, TranslationKey>> = {
  required: 'categories.taxSections.codeRequired',
  pattern: 'categories.taxSections.codePattern',
  reserved: 'categories.taxSections.codeReserved',
  duplicate: 'categories.taxSections.codeDuplicate',
};

/**
 * Maintains the tax sections: one row per section, which expands into an editor in place. One row
 * is open at a time; leaving a row with unsaved changes (another row, a new section, closing the
 * dialog) asks first. Every change goes through {@link TaxSectionsService}, so only the server's
 * answers change the list.
 */
@Component({
  selector: 'app-tax-section-dialog',
  templateUrl: './tax-section-dialog.component.html',
  styleUrl: './tax-section-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TaxCodeComponent],
  host: { class: APP_DIALOG_CLASS },
})
export class TaxSectionDialogComponent {
  protected readonly i18n = inject(TranslationService);
  private readonly dialogRef = inject<DialogRef<void>>(DialogRef);
  private readonly taxSections = inject(TaxSectionsService);
  private readonly taxTags = inject(TaxTagsService);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly titleId: string = TAX_SECTION_DIALOG_TITLE_ID;
  protected readonly editorId: string = 'tax-section-editor';
  protected readonly codeId: string = 'tax-section-code';
  protected readonly codeErrorId: string = 'tax-section-code-error';
  protected readonly nameId: string = 'tax-section-name';
  protected readonly nameErrorId: string = 'tax-section-name-error';
  protected readonly formId: string = 'tax-section-form';
  protected readonly codeMaxLength: number = TAX_SECTION_CODE_MAX_LENGTH;
  protected readonly guidanceFields: readonly TaxSectionDraftField[] = GUIDANCE_FIELDS;

  protected readonly sections: Signal<readonly TaxSection[] | null> = this.taxSections.sections;
  protected readonly loadError: WritableSignal<boolean> = signal<boolean>(false);

  protected readonly openRow: WritableSignal<OpenRow> = signal<OpenRow>(NONE);
  protected readonly draft: WritableSignal<TaxSectionDraft> = signal<TaxSectionDraft>(EMPTY_DRAFT);
  /** Code and name show "required" only once left empty. */
  private readonly touched: WritableSignal<ReadonlySet<TaxSectionDraftField>> = signal<
    ReadonlySet<TaxSectionDraftField>
  >(new Set<TaxSectionDraftField>());
  /** A request of the open row (save, delete, load latest) is in flight. */
  protected readonly busy: WritableSignal<boolean> = signal<boolean>(false);
  protected readonly error: WritableSignal<TaxSectionRowError | null> =
    signal<TaxSectionRowError | null>(null);
  /** The open row was saved and not changed since. */
  protected readonly saved: WritableSignal<boolean> = signal<boolean>(false);
  protected readonly pending: WritableSignal<PendingAction | null> = signal<PendingAction | null>(
    null,
  );

  private readonly codeInput = viewChild<ElementRef<HTMLInputElement>>('codeInput');
  private readonly keepEditingButton =
    viewChild<ElementRef<HTMLButtonElement>>('keepEditingButton');
  private destroyed = false;

  /** How many categories are tagged with each code; `null` until the tags are loaded. */
  private readonly usage: Signal<ReadonlyMap<TaxTagCode, number> | null> = computed(
    (): ReadonlyMap<TaxTagCode, number> | null => {
      const tags: ReadonlyMap<number, TaxTagCode> | null = this.taxTags.tags();
      if (tags === null) return null;
      const counts: Map<TaxTagCode, number> = new Map<TaxTagCode, number>();
      for (const code of tags.values()) counts.set(code, (counts.get(code) ?? 0) + 1);
      return counts;
    },
  );

  protected readonly rows: Signal<readonly RowView[]> = computed((): readonly RowView[] => {
    const open: OpenRow = this.openRow();
    const openCode: TaxSectionCode | null = open.kind === 'existing' ? open.original.code : null;
    const existing: RowView[] = (this.sections() ?? []).map((section: TaxSection): RowView => ({
      key: section.code,
      section,
      open: section.code === openCode,
    }));
    return open.kind === 'new'
      ? [{ key: NEW_KEY, section: null, open: true }, ...existing]
      : existing;
  });

  private readonly next: Signal<TaxSection> = computed((): TaxSection => sectionOf(this.draft()));

  protected readonly dirty: Signal<boolean> = computed((): boolean => {
    const open: OpenRow = this.openRow();
    if (open.kind === 'none') return false;
    const start: TaxSection = sectionOf(open.kind === 'new' ? EMPTY_DRAFT : draftOf(open.original));
    return !sameSection(this.next(), start);
  });

  private readonly codeProblem: Signal<TaxSectionCodeProblem | null> = computed(
    (): TaxSectionCodeProblem | null => {
      const open: OpenRow = this.openRow();
      const ownCode: TaxSectionCode | null = open.kind === 'existing' ? open.original.code : null;
      const taken: Set<TaxSectionCode> = new Set<TaxSectionCode>(
        (this.sections() ?? [])
          .map((s: TaxSection): TaxSectionCode => s.code)
          .filter((code: TaxSectionCode): boolean => code !== ownCode),
      );
      const code: TaxSectionCode = this.next().code;
      if (this.error() === 'duplicate' && code !== ownCode) return 'duplicate';
      return codeProblem(code, taken);
    },
  );

  /** The code error to show: "required" only after the field was left empty. */
  protected readonly codeErrorKey: Signal<TranslationKey | null> = computed(
    (): TranslationKey | null => {
      const problem: TaxSectionCodeProblem | null = this.codeProblem();
      if (problem === null) return null;
      if (problem === 'required' && !this.touched().has('code')) return null;
      return CODE_PROBLEM_KEYS[problem];
    },
  );

  protected readonly nameMissing: Signal<boolean> = computed(
    (): boolean => this.next().name === '' && this.touched().has('name'),
  );

  protected readonly canSave: Signal<boolean> = computed(
    (): boolean =>
      this.dirty() &&
      this.codeProblem() === null &&
      this.next().name !== '' &&
      !this.busy() &&
      this.error() !== 'conflict',
  );

  /** The usage line under the open row's form. */
  protected readonly usageText: Signal<string | null> = computed((): string | null => {
    const open: OpenRow = this.openRow();
    if (open.kind === 'new') return this.i18n.t('categories.taxSections.newHint');
    if (open.kind === 'none') return null;
    const count: number | null = this.usageOf(open.original.code);
    if (count === null) return null;
    if (count === 0) return this.i18n.t('categories.taxSections.notUsed');
    if (count === 1) return this.i18n.t('categories.taxSections.usedByOne');
    return this.i18n.t('categories.taxSections.usedBy', { count });
  });

  /** The message of a failed request of the open row; conflicts get their own banner. */
  protected readonly errorText: Signal<string | null> = computed((): string | null => {
    const error: TaxSectionRowError | null = this.error();
    if (error === null || error === 'conflict' || error === 'duplicate') return null;
    if (error === 'generic') return this.i18n.t('categories.taxSections.error');
    const open: OpenRow = this.openRow();
    if (open.kind !== 'existing') throw new Error('only a stored section can be in use');
    const count: number = this.usageOf(open.original.code) ?? 0;
    // The tags are reloaded when the server says "in use"; until then the count may be stale.
    if (count === 0) return this.i18n.t('categories.taxSections.inUseUnknown');
    if (count === 1) return this.i18n.t('categories.taxSections.inUseOne');
    return this.i18n.t('categories.taxSections.inUse', { count });
  });

  constructor() {
    const destroyRef: DestroyRef = this.destroyRef;
    destroyRef.onDestroy((): void => {
      this.destroyed = true;
    });
    if (this.taxSections.sections() === null) {
      this.taxSections
        .load()
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          error: (cause: unknown): void => {
            this.loadError.set(true);
            throw cause;
          },
        });
    }
    if (this.taxTags.tags() === null) this.loadTags();

    // Escape and the backdrop close through `requestClose`, which asks first on unsaved changes
    // and waits for a request in flight.
    this.dialogRef.disableClose = true;
    this.dialogRef.backdropClick
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((): void => this.requestClose());
    this.dialogRef.keydownEvents
      .pipe(
        filter((event: KeyboardEvent): boolean => event.key === 'Escape' && !hasModifierKey(event)),
        takeUntilDestroyed(destroyRef),
      )
      .subscribe((event: KeyboardEvent): void => {
        event.preventDefault();
        this.requestClose();
      });
  }

  protected labelKey(field: TaxSectionDraftField): TranslationKey {
    return FIELD_LABEL_KEYS[field];
  }

  protected fieldId(field: TaxSectionDraftField): string {
    return `tax-section-${field}`;
  }

  protected usageOf(code: TaxSectionCode): number | null {
    const usage: ReadonlyMap<TaxTagCode, number> | null = this.usage();
    return usage === null ? null : (usage.get(code) ?? 0);
  }

  /** The code the row's head shows: the draft's while the row is open. */
  protected headCode(row: RowView): string {
    if (row.open) return this.draft().code.trim();
    if (row.section === null) throw new Error('the new section is always open');
    return row.section.code;
  }

  protected headName(row: RowView): string {
    if (row.open) return this.draft().name.trim();
    if (row.section === null) throw new Error('the new section is always open');
    return row.section.name;
  }

  protected headForm(row: RowView): string {
    if (row.open) return this.draft().form.trim();
    if (row.section === null) throw new Error('the new section is always open');
    return row.section.form ?? '';
  }

  protected toggle(row: RowView): void {
    if (row.open) {
      this.request({ kind: 'collapse' });
      return;
    }
    if (row.section === null) throw new Error('the new section is always open');
    this.request({ kind: 'open', code: row.section.code });
  }

  protected startNew(): void {
    this.request({ kind: 'new' });
  }

  protected requestClose(): void {
    this.request({ kind: 'close' });
  }

  /** Cancel is an explicit discard: the row closes without asking. */
  protected cancel(): void {
    if (this.busy()) throw new Error('cannot cancel while a request is in flight');
    this.collapse();
  }

  protected confirmDiscard(): void {
    const action: PendingAction | null = this.pending();
    if (action === null) throw new Error('nothing waits for a discard');
    this.pending.set(null);
    this.perform(action);
  }

  protected keepEditing(): void {
    this.pending.set(null);
  }

  protected onInput(field: TaxSectionDraftField, event: Event): void {
    const value: string = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
    this.draft.update((d: TaxSectionDraft): TaxSectionDraft => ({ ...d, [field]: value }));
    this.saved.set(false);
    // A conflict stays until the latest version is loaded; everything else was about the old input.
    if (this.error() !== 'conflict') this.error.set(null);
  }

  protected onBlur(field: TaxSectionDraftField): void {
    this.touched.update(
      (fields: ReadonlySet<TaxSectionDraftField>): ReadonlySet<TaxSectionDraftField> =>
        new Set<TaxSectionDraftField>([...fields, field]),
    );
  }

  protected save(): void {
    // A second click before the disabled button repaints.
    if (this.busy()) return;
    if (!this.canSave()) throw new Error('nothing to save');
    const open: OpenRow = this.openRow();
    const next: TaxSection = this.next();
    const request: Observable<TaxSection> =
      open.kind === 'new'
        ? this.taxSections.create(next)
        : open.kind === 'existing'
          ? this.taxSections
              .update(open.original.code, { expected: open.original, next })
              .pipe(map((): TaxSection => next))
          : this.noOpenRow();
    // Not tied to this component: the service applies a confirmed save even if the dialog went
    // away meanwhile.
    this.run(request, (stored: TaxSection): void => {
      this.openExisting(stored);
      this.saved.set(true);
    });
  }

  /** Delete for a stored section; Discard for the new one (nothing is stored yet). */
  protected remove(): void {
    const open: OpenRow = this.openRow();
    if (open.kind === 'new') {
      this.collapse();
      return;
    }
    if (open.kind !== 'existing') throw new Error('no tax section is open');
    if (this.busy()) return;
    this.run(this.taxSections.remove(open.original.code), (): void => this.collapse());
  }

  /** After a conflict: reloads the sections and reopens the row with the stored values. */
  protected loadLatest(): void {
    const open: OpenRow = this.openRow();
    if (open.kind !== 'existing') throw new Error('only a stored section can conflict');
    if (this.busy()) return;
    const code: TaxSectionCode = open.original.code;
    this.run(this.taxSections.load(), (): void => {
      const fresh: TaxSection | undefined = this.sections()?.find(
        (s: TaxSection): boolean => s.code === code,
      );
      // Deleted elsewhere: nothing left to edit.
      if (fresh) this.openExisting(fresh);
      else this.collapse();
    });
  }

  private run<T>(request: Observable<T>, done: (value: T) => void): void {
    this.busy.set(true);
    this.error.set(null);
    this.pending.set(null);
    request.subscribe({
      next: (value: T): void => {
        if (this.destroyed) return;
        this.busy.set(false);
        done(value);
      },
      error: (cause: unknown): void => {
        if (this.destroyed) return;
        this.busy.set(false);
        const error: TaxSectionRowError = toTaxSectionRowError(cause);
        this.error.set(error);
        // The server knows a tag the loaded tags do not: refresh the counts.
        if (error === 'in-use') this.loadTags();
      },
    });
  }

  private request(action: PendingAction): void {
    if (this.busy()) return;
    if (this.dirty()) {
      this.pending.set(action);
      afterNextRender(
        (): void => {
          const button: ElementRef<HTMLButtonElement> | undefined = this.keepEditingButton();
          if (!button) throw new Error('the discard bar is not rendered');
          button.nativeElement.focus();
        },
        { injector: this.injector },
      );
      return;
    }
    this.perform(action);
  }

  private perform(action: PendingAction): void {
    switch (action.kind) {
      case 'open': {
        const section: TaxSection | undefined = this.sections()?.find(
          (s: TaxSection): boolean => s.code === action.code,
        );
        if (!section) throw new Error(`tax section "${action.code}" is not loaded`);
        this.openExisting(section);
        return;
      }
      case 'new':
        this.reset({ kind: 'new' }, EMPTY_DRAFT);
        afterNextRender(
          (): void => {
            const input: ElementRef<HTMLInputElement> | undefined = this.codeInput();
            if (!input) throw new Error('the code input is not rendered');
            input.nativeElement.focus();
          },
          { injector: this.injector },
        );
        return;
      case 'collapse':
        this.collapse();
        return;
      case 'close':
        this.dialogRef.close();
        return;
    }
  }

  private openExisting(section: TaxSection): void {
    this.reset({ kind: 'existing', original: section }, draftOf(section));
  }

  private collapse(): void {
    this.reset(NONE, EMPTY_DRAFT);
  }

  private reset(open: OpenRow, draft: TaxSectionDraft): void {
    this.openRow.set(open);
    this.draft.set(draft);
    this.touched.set(new Set<TaxSectionDraftField>());
    this.error.set(null);
    this.saved.set(false);
    this.pending.set(null);
  }

  private loadTags(): void {
    this.taxTags.load().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }

  private noOpenRow(): never {
    throw new Error('no tax section is open');
  }
}
