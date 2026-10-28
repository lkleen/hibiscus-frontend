import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  InjectionToken,
  Signal,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import type { TaxSection } from '@hibiscus-frontend/shared/contracts/tax-tags';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { from, switchMap, tap, timer } from 'rxjs';
import type { Locale } from '../../../../core/models/locale.model';
import type { TranslationKey } from '../../../../core/models/translation.model';
import { LocaleService } from '../../../../core/services/locale.service';
import { TranslationService } from '../../../../core/services/translation.service';
import type { DateRange } from '../../../../core/utils/date-range';
import { APP_DIALOG_CLASS } from '../../../../shared/dialog/dialog-classes';
import { downloadBlob, exportFileName } from '../export-file';
import { toCsv, toJson, toPdf, type PdfResult } from '../export-writers';
import type {
  ExportDepth,
  ExportDocument,
  ExportFormat,
  ExportOptions,
  ExportScope,
  PdfFit,
  PdfOrientation,
  PdfPageSetup,
  PdfPaperFormat,
} from '../export.model';
import type { PdfLayout } from '../pdf-layout';
import { clampDepth, type ExportSource } from '../transactions-export';

/** The file writers and the download, injectable so specs can replace them. */
export interface ExportFileWriters {
  readonly toCsv: typeof toCsv;
  readonly toJson: typeof toJson;
  readonly toPdf: typeof toPdf;
  readonly download: typeof downloadBlob;
}

export const EXPORT_FILE_WRITERS: InjectionToken<ExportFileWriters> =
  new InjectionToken<ExportFileWriters>('EXPORT_FILE_WRITERS', {
    providedIn: 'root',
    factory: (): ExportFileWriters => ({ toCsv, toJson, toPdf, download: downloadBlob }),
  });

/** The `ariaLabelledBy` target of the dialog. */
export const EXPORT_DIALOG_TITLE_ID = 'export-dialog-title';

/** How long the options must rest before the preview is generated again. */
export const EXPORT_PREVIEW_DEBOUNCE_MS = 300;

/** Lines of a CSV/JSON file shown in the preview. */
const PREVIEW_LINES = 20;

export interface ExportDialogData {
  readonly source: ExportSource;
  readonly scope: Signal<ExportScope>;
  /** For the file name. */
  readonly range: Signal<DateRange | null>;
  readonly initial: ExportOptions;
  /** Called with every change, so the next dialog for this view starts from it. */
  readonly remember: (options: ExportOptions) => void;
}

interface PreviewInput {
  readonly doc: ExportDocument;
  readonly options: ExportOptions;
  readonly locale: Locale;
}

/** A generated preview before it is shown: a PDF still as a blob, so no object URL exists yet. */
type RenderedPreview =
  | { readonly kind: 'pdf'; readonly blob: Blob; readonly hitsFloor: boolean }
  | { readonly kind: 'text'; readonly text: string };

type Preview =
  | {
      readonly kind: 'pdf';
      readonly objectUrl: string;
      readonly src: SafeResourceUrl;
      readonly hitsFloor: boolean;
    }
  | { readonly kind: 'text'; readonly text: string };

interface WrittenFile {
  readonly blob: Blob;
  /** Only for PDF. */
  readonly layout: PdfLayout | null;
}

interface FitChoice {
  readonly value: PdfFit;
  readonly labelKey: TranslationKey;
  readonly hintKey: TranslationKey;
}

const FORMAT_HINT_KEYS: Readonly<Record<ExportFormat, TranslationKey>> = {
  csv: 'transactions.export.hintCsv',
  pdf: 'transactions.export.hintPdf',
  json: 'transactions.export.hintJson',
};

const PAPER_KEYS: Readonly<Record<PdfPaperFormat, TranslationKey>> = {
  a4: 'transactions.export.paperA4',
  a3: 'transactions.export.paperA3',
  a5: 'transactions.export.paperA5',
  letter: 'transactions.export.paperLetter',
  legal: 'transactions.export.paperLegal',
};

/**
 * Configures and downloads an export of the active tab: format, detail level (by category) and,
 * for PDF, the page setup, next to a live preview of the real file. The document is built afresh
 * from the source when Export is clicked, so the file always matches what the view shows then.
 */
@Component({
  selector: 'app-export-dialog',
  templateUrl: './export-dialog.component.html',
  styleUrl: './export-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: APP_DIALOG_CLASS },
})
export class ExportDialogComponent {
  protected readonly i18n = inject(TranslationService);
  private readonly locale = inject(LocaleService).locale;
  private readonly sanitizer = inject(DomSanitizer);
  private readonly writers: ExportFileWriters = inject(EXPORT_FILE_WRITERS);
  private readonly data: ExportDialogData = inject<ExportDialogData>(DIALOG_DATA);
  private readonly dialogRef: DialogRef<void, ExportDialogComponent> =
    inject<DialogRef<void, ExportDialogComponent>>(DialogRef);
  private destroyed = false;

  protected readonly titleId: string = EXPORT_DIALOG_TITLE_ID;
  protected readonly formats: readonly ExportFormat[] = ['csv', 'pdf', 'json'];
  protected readonly papers: readonly PdfPaperFormat[] = ['a4', 'a3', 'a5', 'letter', 'legal'];
  protected readonly orientations: readonly PdfOrientation[] = ['portrait', 'landscape'];
  protected readonly fits: readonly FitChoice[] = [
    {
      value: 'shrink',
      labelKey: 'transactions.export.fitShrink',
      hintKey: 'transactions.export.fitShrinkHint',
    },
    {
      value: 'wrap',
      labelKey: 'transactions.export.fitWrap',
      hintKey: 'transactions.export.fitWrapHint',
    },
    {
      value: 'split',
      labelKey: 'transactions.export.fitSplit',
      hintKey: 'transactions.export.fitSplitHint',
    },
  ];
  protected readonly paperKeys: Readonly<Record<PdfPaperFormat, TranslationKey>> = PAPER_KEYS;

  protected readonly scope: Signal<ExportScope> = this.data.scope;
  protected readonly isList: boolean = this.data.source.maxDepth === null;

  protected readonly format = signal<ExportFormat>(this.data.initial.format);
  private readonly depth = signal<ExportDepth>(this.data.initial.depth);
  /** The chosen tax section codes, `null` = not limited; see {@link effectiveTaxSections}. */
  private readonly taxSelection = signal<readonly string[] | null>(this.data.initial.taxSections);
  protected readonly paper = signal<PdfPaperFormat>(this.data.initial.page.format);
  protected readonly orientation = signal<PdfOrientation>(this.data.initial.page.orientation);
  protected readonly fit = signal<PdfFit>(this.data.initial.page.fit);
  protected readonly busy = signal<boolean>(false);
  protected readonly preview = signal<Preview | null>(null);
  /** True from an option change until its preview is shown. */
  protected readonly previewPending = signal<boolean>(true);

  /** The slider's steps: every category level, then "every transaction"; empty for the list. */
  protected readonly depthSteps: Signal<readonly ExportDepth[]> = computed(
    (): readonly ExportDepth[] => {
      const maxDepth: Signal<number> | null = this.data.source.maxDepth;
      if (maxDepth === null) return [];
      const levels: number[] = Array.from(
        { length: maxDepth() },
        (_: unknown, index: number): number => index + 1,
      );
      return [...levels, 'all'];
    },
  );

  /** The chosen depth, kept within the report should it lose levels while the dialog is open. */
  private readonly effectiveDepth: Signal<ExportDepth> = computed((): ExportDepth =>
    clampDepth(this.depth(), this.data.source.maxDepth?.() ?? null),
  );

  /** The sections on offer; `null` while they load (and for the list, which has none). */
  protected readonly taxSectionChoices: Signal<readonly TaxSection[] | null> = computed(
    (): readonly TaxSection[] | null => this.data.source.taxSections?.() ?? null,
  );

  /** The chosen codes without those that no longer exist once the sections are loaded. */
  private readonly effectiveTaxSections: Signal<readonly string[] | null> = computed(
    (): readonly string[] | null => {
      const selection: readonly string[] | null = this.taxSelection();
      const choices: readonly TaxSection[] | null = this.taxSectionChoices();
      if (selection === null || choices === null) return selection;
      return selection.filter((code: string): boolean =>
        choices.some((section: TaxSection): boolean => section.code === code),
      );
    },
  );

  protected readonly taxOnly: Signal<boolean> = computed(
    (): boolean => this.effectiveTaxSections() !== null,
  );

  /** The tax filter is on but no section is ticked: nothing to export. */
  protected readonly noTaxSection: Signal<boolean> = computed(
    (): boolean => this.effectiveTaxSections()?.length === 0,
  );

  /** Export waits for the sections (the filter needs them) and for at least one ticked section. */
  protected readonly exportBlocked: Signal<boolean> = computed(
    (): boolean => (!this.isList && this.taxSectionChoices() === null) || this.noTaxSection(),
  );

  protected readonly depthIndex: Signal<number> = computed((): number => {
    const index: number = this.depthSteps().indexOf(this.effectiveDepth());
    if (index < 0 && !this.isList) throw new Error(`depth ${this.effectiveDepth()} has no step`);
    return index;
  });

  protected readonly depthLabel: Signal<string> = computed((): string =>
    this.stepLabel(this.effectiveDepth()),
  );

  protected readonly options: Signal<ExportOptions> = computed((): ExportOptions => ({
    format: this.format(),
    depth: this.effectiveDepth(),
    taxSections: this.effectiveTaxSections(),
    page: { format: this.paper(), orientation: this.orientation(), fit: this.fit() },
  }));

  /** The document as the preview shows it; Export builds its own at click time. */
  private readonly document: Signal<ExportDocument> = computed((): ExportDocument =>
    this.data.source.build(this.options()),
  );

  protected readonly rowCount: Signal<number> = computed((): number => this.document().rows.length);

  protected readonly fileName: Signal<string> = computed((): string =>
    exportFileName({
      view: this.data.source.view,
      range: this.data.range(),
      format: this.format(),
    }),
  );

  protected readonly formatHint: Signal<string> = computed((): string =>
    this.i18n.t(FORMAT_HINT_KEYS[this.format()]),
  );

  protected readonly hitsFloor: Signal<boolean> = computed((): boolean => {
    const preview: Preview | null = this.preview();
    return this.format() === 'pdf' && preview?.kind === 'pdf' && preview.hitsFloor;
  });

  private readonly previewInput: Signal<PreviewInput> = computed((): PreviewInput => ({
    doc: this.document(),
    options: this.options(),
    locale: this.locale(),
  }));

  constructor() {
    effect((): void => {
      const options: ExportOptions = this.options();
      untracked((): void => this.data.remember(options));
    });

    // Each change restarts the wait (debounce) and drops a preview that is still being generated,
    // so only the newest one is ever shown. Not `debounceTime`: it flushes its pending value when
    // `toObservable` completes on destroy, which would generate a file for a closed dialog. The
    // object URL is created only on arrival in `subscribe`, so a dropped preview never leaves an
    // unrevoked URL behind.
    toObservable(this.previewInput)
      .pipe(
        tap((): void => this.previewPending.set(true)),
        switchMap((input: PreviewInput) =>
          timer(EXPORT_PREVIEW_DEBOUNCE_MS).pipe(switchMap(() => from(this.renderPreview(input)))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((rendered: RenderedPreview): void => {
        this.showPreview(this.toPreview(rendered));
        this.previewPending.set(false);
      });

    inject(DestroyRef).onDestroy((): void => {
      this.destroyed = true;
      this.showPreview(null);
    });
  }

  protected tickLabel(step: ExportDepth): string {
    return step === 'all'
      ? this.i18n.t('transactions.export.tickAll')
      : this.i18n.t('transactions.export.tickLevel', { level: step });
  }

  protected stepLabel(step: ExportDepth): string {
    if (step === 'all') return this.i18n.t('transactions.export.depthAll');
    if (step === 1) return this.i18n.t('transactions.export.depthTop');
    return this.i18n.t('transactions.export.depthLevels', { count: step });
  }

  protected onDepthInput(event: Event): void {
    const target: EventTarget | null = event.target;
    if (!(target instanceof HTMLInputElement)) throw new Error('expected a range input event');
    const step: ExportDepth | undefined = this.depthSteps()[Number(target.value)];
    if (step === undefined) throw new Error(`no detail level at step ${target.value}`);
    this.depth.set(step);
  }

  protected onTaxOnlyChange(event: Event): void {
    const choices: readonly TaxSection[] | null = this.taxSectionChoices();
    if (choices === null) throw new Error('tax sections are not loaded');
    this.taxSelection.set(
      this.checkboxOf(event).checked ? choices.map((section: TaxSection) => section.code) : null,
    );
  }

  protected isTaxSectionChosen(code: string): boolean {
    return this.effectiveTaxSections()?.includes(code) ?? false;
  }

  protected onTaxSectionChange(code: string, event: Event): void {
    const current: readonly string[] | null = this.effectiveTaxSections();
    const choices: readonly TaxSection[] | null = this.taxSectionChoices();
    if (current === null || choices === null) throw new Error('the tax filter is off');
    const chosen: boolean = this.checkboxOf(event).checked;
    // In the sections' order, so the file names them the same way however they were ticked.
    this.taxSelection.set(
      choices
        .map((section: TaxSection): string => section.code)
        .filter((candidate: string): boolean =>
          candidate === code ? chosen : current.includes(candidate),
        ),
    );
  }

  private checkboxOf(event: Event): HTMLInputElement {
    const target: EventTarget | null = event.target;
    if (!(target instanceof HTMLInputElement)) throw new Error('expected a checkbox event');
    return target;
  }

  protected onPaperChange(event: Event): void {
    const target: EventTarget | null = event.target;
    if (!(target instanceof HTMLSelectElement)) throw new Error('expected a select change event');
    const paper: PdfPaperFormat | undefined = this.papers.find(
      (candidate: PdfPaperFormat): boolean => candidate === target.value,
    );
    if (paper === undefined) throw new Error(`unknown paper format "${target.value}"`);
    this.paper.set(paper);
  }

  protected cancel(): void {
    this.dialogRef.close();
  }

  /** Builds the document now, writes it, starts the download and closes. Errors propagate. */
  protected async download(): Promise<void> {
    // A second click before the disabled button repaints.
    if (this.busy()) return;
    if (this.exportBlocked())
      throw new Error('the export is blocked: sections missing or none chosen');
    const options: ExportOptions = this.options();
    const fileName: string = this.fileName();
    const doc: ExportDocument = untracked((): ExportDocument => this.data.source.build(options));
    this.busy.set(true);
    this.dialogRef.disableClose = true;
    try {
      const file: WrittenFile = await this.write({ doc, options, locale: this.locale() });
      // Closed from outside (tab switch) while the PDF was generated: the export was abandoned.
      if (this.destroyed) return;
      this.writers.download(file.blob, fileName);
      this.dialogRef.close();
    } finally {
      this.busy.set(false);
      this.dialogRef.disableClose = false;
    }
  }

  private async write(input: PreviewInput): Promise<WrittenFile> {
    const { doc, options, locale }: PreviewInput = input;
    switch (options.format) {
      case 'csv':
        return {
          blob: this.writers.toCsv(doc, {
            locale,
            levelHeader: this.i18n.t('transactions.export.levelHeader'),
          }),
          layout: null,
        };
      case 'json':
        return { blob: this.writers.toJson(doc, new Date()), layout: null };
      case 'pdf': {
        const page: PdfPageSetup = options.page;
        const result: PdfResult = await this.writers.toPdf(doc, {
          locale,
          page,
          labels: {
            page: (current: number, total: number): string =>
              this.i18n.t('transactions.export.pdfPage', { current, total }),
          },
        });
        return { blob: result.blob, layout: result.layout };
      }
    }
  }

  private async renderPreview(input: PreviewInput): Promise<RenderedPreview> {
    const file: WrittenFile = await this.write(input);
    if (input.options.format === 'pdf') {
      if (file.layout === null) throw new Error('a PDF export must report its layout');
      return { kind: 'pdf', blob: file.blob, hitsFloor: file.layout.hitsFloor };
    }
    const text: string = (await file.blob.text()).replace(/^\uFEFF/, '');
    return { kind: 'text', text: text.split(/\r?\n/).slice(0, PREVIEW_LINES).join('\n') };
  }

  private toPreview(rendered: RenderedPreview): Preview {
    if (rendered.kind === 'text') return rendered;
    const objectUrl: string = URL.createObjectURL(rendered.blob);
    return {
      kind: 'pdf',
      objectUrl,
      src: this.sanitizer.bypassSecurityTrustResourceUrl(`${objectUrl}#view=FitH&navpanes=0`),
      hitsFloor: rendered.hitsFloor,
    };
  }

  /** Swaps the shown preview, revoking the object URL of the one it replaces. */
  private showPreview(preview: Preview | null): void {
    const previous: Preview | null = this.preview();
    if (previous?.kind === 'pdf') URL.revokeObjectURL(previous.objectUrl);
    this.preview.set(preview);
  }
}
