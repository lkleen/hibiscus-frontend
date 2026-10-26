import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
  type Signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import type { TaxTagChange, TaxTagCode } from '@hibiscus-frontend/shared/contracts/tax-tags';
import { APP_DIALOG_CLASS } from '../../../shared/dialog/dialog-classes';
import { ApiService } from '../../services/api.service';
import { TaxTagConflictError, TaxTagsService } from '../../services/tax-tags.service';
import { TranslationService } from '../../services/translation.service';
import { TaxCodeComponent } from '../tax-code/tax-code.component';
import { TaxDescriptionComponent } from '../tax-section-picker/tax-description.component';
import {
  taxKey,
  taxPlainDescription,
  taxSectionDescription,
  type TaxDescription,
} from '../tax-i18n';
import {
  TAX_EXCLUDED_CODE,
  TAX_SECTIONS,
  effectiveTaxSection,
  type EffectiveTaxSection,
  type TaxSection,
} from '../tax-sections';
import type { TaxTagSectionDialogData } from './tax-tag-dialog.model';

/** The `ariaLabelledBy` target of the dialog. */
export const TAX_TAG_SECTION_TITLE_ID = 'tax-tag-section-title';

/** `inherit` clears the category's own tag; otherwise the code to store. */
export type TaxTagChoice = 'inherit' | TaxTagCode;

/** One radio option of the dialog. */
interface TaxTagOption {
  readonly choice: TaxTagChoice;
  readonly label: string;
  /** The code shown next to the label; `null` for none. */
  readonly code: string | null;
  readonly inherited: boolean;
  /** What the choice means, shown under the list while the row is hovered or focused. */
  readonly description: TaxDescription;
}

/**
 * Picks the tax section of one category: the parent's (inherit), one of the sections, or "not
 * tax-relevant" (`St-0`). Saves through `TaxTagsService`. Closes with `true` once saved; a
 * conflicting save stays open with the reloaded value.
 */
@Component({
  selector: 'app-tax-tag-section-dialog',
  templateUrl: './tax-tag-section-dialog.component.html',
  styleUrl: './tax-tag-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: APP_DIALOG_CLASS },
  imports: [TaxCodeComponent, TaxDescriptionComponent],
})
export class TaxTagSectionDialogComponent {
  protected readonly i18n = inject(TranslationService);
  private readonly data: TaxTagSectionDialogData = inject<TaxTagSectionDialogData>(DIALOG_DATA);
  private readonly dialogRef: DialogRef<boolean, TaxTagSectionDialogComponent> =
    inject<DialogRef<boolean, TaxTagSectionDialogComponent>>(DialogRef);
  private readonly api = inject(ApiService);
  private readonly tagsService = inject(TaxTagsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly titleId: string = TAX_TAG_SECTION_TITLE_ID;
  protected readonly category: CategoryRow = this.data.category;
  protected readonly afterCreate: boolean = this.data.afterCreate;
  protected readonly radioName: string = `tax-tag-section-${this.data.category.id}`;

  /** All categories, to resolve the inherited section; `null` until loaded. */
  private readonly categories = signal<readonly CategoryRow[] | null>(null);
  protected readonly ready: Signal<boolean> = computed(
    (): boolean => this.tagsService.tags() !== null && this.categories() !== null,
  );

  /** The tag stored now; `null` = untagged. */
  private readonly stored: Signal<TaxTagCode | null> = computed((): TaxTagCode | null => {
    const tags: ReadonlyMap<number, TaxTagCode> | null = this.tagsService.tags();
    return tags === null ? null : (tags.get(this.category.id) ?? null);
  });

  private readonly picked = signal<TaxTagChoice | null>(null);
  protected readonly choice: Signal<TaxTagChoice> = computed(
    (): TaxTagChoice => this.picked() ?? this.stored() ?? 'inherit',
  );

  protected readonly options: Signal<readonly TaxTagOption[]> = computed(
    (): readonly TaxTagOption[] => [
      this.inheritOption(),
      ...TAX_SECTIONS.map((section: TaxSection): TaxTagOption => ({
        choice: section.code,
        label: this.i18n.t(taxKey(section.nameKey)),
        code: section.code,
        inherited: false,
        description: taxSectionDescription(this.i18n, section),
      })),
      {
        choice: TAX_EXCLUDED_CODE,
        label: this.i18n.t('tax.section.excluded'),
        code: TAX_EXCLUDED_CODE,
        inherited: false,
        description: taxPlainDescription(this.i18n.t('tax.picker.excludedDescription')),
      },
    ],
  );

  /** The row last hovered or focused; `null` = the chosen one. */
  private readonly shown = signal<TaxTagChoice | null>(null);
  protected readonly descriptionId: string = `tax-tag-section-description-${this.data.category.id}`;
  protected readonly describedChoice: Signal<TaxTagChoice> = computed(
    (): TaxTagChoice => this.shown() ?? this.choice(),
  );
  protected readonly described: Signal<TaxTagOption> = computed((): TaxTagOption => {
    const found: TaxTagOption | undefined = this.options().find(
      (option: TaxTagOption): boolean => option.choice === this.describedChoice(),
    );
    if (found === undefined) throw new Error(`no tax tag option "${this.describedChoice()}"`);
    return found;
  });

  /** The tag to store; `undefined` while nothing changes. */
  private readonly next: Signal<TaxTagCode | null | undefined> = computed(
    (): TaxTagCode | null | undefined => {
      const choice: TaxTagChoice = this.choice();
      const next: TaxTagCode | null = choice === 'inherit' ? null : choice;
      return next === this.stored() ? undefined : next;
    },
  );

  protected readonly saving = signal<boolean>(false);
  protected readonly error = signal<string | null>(null);
  protected readonly canSave: Signal<boolean> = computed(
    (): boolean => this.ready() && !this.saving() && this.next() !== undefined,
  );

  constructor() {
    this.api
      .getCategories()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows: CategoryRow[]): void => this.categories.set(rows),
        error: (cause: unknown): void => {
          this.error.set(this.i18n.t('tax.loadError'));
          throw cause;
        },
      });
    if (this.tagsService.tags() === null) {
      this.tagsService
        .load()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          error: (cause: unknown): void => {
            this.error.set(this.i18n.t('tax.loadError'));
            throw cause;
          },
        });
    }
  }

  protected show(choice: TaxTagChoice): void {
    this.shown.set(choice);
  }

  protected pick(choice: TaxTagChoice): void {
    this.picked.set(choice);
  }

  protected cancel(): void {
    this.dialogRef.close(false);
  }

  protected save(): void {
    const next: TaxTagCode | null | undefined = this.next();
    if (!this.canSave() || next === undefined) throw new Error('nothing to save');
    const change: TaxTagChange = {
      category_id: this.category.id,
      expected: this.stored(),
      next,
    };
    this.saving.set(true);
    this.error.set(null);
    // The save outlives the dialog: no close while it runs.
    this.dialogRef.disableClose = true;
    this.tagsService
      .save([change])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (): void => {
          this.saving.set(false);
          this.dialogRef.disableClose = false;
          this.dialogRef.close(true);
        },
        error: (cause: unknown): void => {
          this.saving.set(false);
          this.dialogRef.disableClose = false;
          if (cause instanceof TaxTagConflictError) {
            // The service reloaded the tags: show the stored value again.
            this.picked.set(null);
            this.error.set(this.failureText('tax.tagSave.conflict'));
            return;
          }
          this.error.set(this.failureText('tax.tagSave.error'));
          throw cause;
        },
      });
  }

  private failureText(key: 'tax.tagSave.conflict' | 'tax.tagSave.error'): string {
    return this.i18n.t(key, { name: this.category.name, saved: 0, total: 1 });
  }

  /** "Same as <parent>" with the parent's effective tag, or "No tax section" for a root chain. */
  private inheritOption(): TaxTagOption {
    const categories: readonly CategoryRow[] | null = this.categories();
    const tags: ReadonlyMap<number, TaxTagCode> | null = this.tagsService.tags();
    const none: TaxTagOption = {
      choice: 'inherit',
      label: this.i18n.t('tax.section.none'),
      code: null,
      inherited: false,
      description: taxPlainDescription(this.i18n.t('tax.picker.noneDescription')),
    };
    if (categories === null || tags === null) return none;
    const byId: ReadonlyMap<number, CategoryRow> = new Map(
      categories.map((c: CategoryRow): [number, CategoryRow] => [c.id, c]),
    );
    const parent: CategoryRow | undefined =
      this.category.parent_id === null ? undefined : byId.get(this.category.parent_id);
    if (parent === undefined) return none;
    const effective: EffectiveTaxSection = effectiveTaxSection({ category: parent, byId, tags });
    let code: string | null = null;
    if (effective.section !== null) code = effective.section.code;
    else if (effective.sourceCategoryId !== null) code = TAX_EXCLUDED_CODE;
    return {
      choice: 'inherit',
      label: this.i18n.t('tax.section.sameAs', { name: parent.name }),
      code,
      inherited: true,
      description: taxPlainDescription(
        code === null
          ? this.i18n.t('tax.picker.noneDescription')
          : this.i18n.t('tax.picker.inheritDescription', { code }),
      ),
    };
  }
}
