import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  type Signal,
} from '@angular/core';
import type { TaxSectionCode } from '@hibiscus-frontend/shared/contracts/tax-tags';
import type { Locale } from '../../../core/models/locale.model';
import type { TranslationKey } from '../../../core/models/translation.model';
import { LocaleService } from '../../../core/services/locale.service';
import { TranslationService } from '../../../core/services/translation.service';
import { TaxCodeComponent } from '../../../core/tax/tax-code/tax-code.component';
import { guidanceKey, taxKey } from '../../../core/tax/tax-i18n';
import type { TaxSection } from '../../../core/tax/tax-sections';
import { DataTableCellDirective } from '../../../shared/components/data-table/data-table-cell.directive';
import { DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import {
  colDef,
  type DataTableColDef,
  type DataTableOptions,
} from '../../../shared/components/data-table/data-table.model';
import { downloadBlob } from '../../transactions/export/export-file';
import { AmountCellComponent } from '../../transactions/cells/amount-cell/amount-cell.component';
import { TaxEuroPipe } from '../tax-euro.pipe';
import { taxPdfFileName, toTaxPdf, type TaxPdfLabels, type TaxPdfSectionLabels } from '../tax-pdf';
import type { TaxReceipt, TaxReport } from '../tax-report';
import { TaxReturnStore } from '../tax-return.store';

/**
 * Step ④: one sheet per form section — the form as heading, the section's code and totals
 * (income and expenses kept apart, both positive), the categories behind it, the numbered
 * receipts on demand and the section's fixed facts — and the PDF of all of it.
 */
@Component({
  selector: 'app-tax-step-result',
  templateUrl: './step-result.component.html',
  styleUrls: ['../tax-ui.scss', './step-result.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DataTableComponent,
    DataTableCellDirective,
    AmountCellComponent,
    TaxCodeComponent,
    TaxEuroPipe,
  ],
})
export class StepResultComponent {
  protected readonly i18n = inject(TranslationService);
  protected readonly store = inject(TaxReturnStore);
  protected readonly locale = inject(LocaleService).locale;

  protected readonly report: Signal<TaxReport> = this.store.report;

  /** Sections whose receipt list is open; the table renders only then. */
  protected readonly open = signal<ReadonlySet<TaxSectionCode>>(new Set());
  protected readonly downloading = signal<boolean>(false);
  protected readonly downloadError = signal<boolean>(false);

  protected readonly receiptColumns: readonly DataTableColDef<TaxReceipt>[] = [
    colDef<TaxReceipt, number>({
      colId: 'no',
      headerKey: 'tax.result.colNo',
      valueGetter: (r) => r.no,
      filter: false,
    }),
    colDef<TaxReceipt, string>({
      colId: 'datum',
      headerKey: 'tax.result.colDate',
      valueGetter: (r) => r.transaction.datum,
      filter: false,
    }),
    colDef<TaxReceipt, string | null>({
      colId: 'empfaenger_name',
      headerKey: 'tax.result.colPayee',
      valueGetter: (r) => r.transaction.empfaenger_name,
      filter: false,
    }),
    colDef<TaxReceipt, string | null>({
      colId: 'empfaenger_konto',
      headerKey: 'tax.result.colIban',
      valueGetter: (r) => r.transaction.empfaenger_konto,
      filter: false,
    }),
    colDef<TaxReceipt, string | null>({
      colId: 'zweck',
      headerKey: 'tax.result.colPurpose',
      valueGetter: (r) => r.transaction.zweck,
      filter: false,
    }),
    colDef<TaxReceipt, string>({
      colId: 'category',
      headerKey: 'tax.result.colCategory',
      valueGetter: (r) => this.pathOf(r.category.id),
      filter: false,
    }),
    colDef<TaxReceipt, number>({
      colId: 'betrag',
      headerKey: 'tax.result.colAmount',
      valueGetter: (r) => r.transaction.betrag,
      cellRenderer: 'amount',
      align: 'end',
      filter: false,
    }),
  ];

  protected readonly receiptOptions: DataTableOptions<TaxReceipt> = {
    getRowId: (r) => r.no,
    defaultSort: [{ colId: 'no', order: 1 }],
    quickFilter: false,
    scrollHeight: false,
    columnReorder: false,
    pagination: { pageSize: 20, pageSizes: [20, 50, 100] },
    emptyKey: 'tax.result.noReceipts',
  };

  protected readonly hasSections: Signal<boolean> = computed(
    (): boolean => this.report().sections.length > 0,
  );

  protected nameKey(key: string): TranslationKey {
    return taxKey(key);
  }

  protected noteKey(section: TaxSection): TranslationKey {
    return guidanceKey(section, 'note');
  }

  protected onToggle(code: TaxSectionCode, event: Event): void {
    const target: EventTarget | null = event.target;
    if (!(target instanceof HTMLDetailsElement)) throw new Error('expected a details element');
    const next = new Set<TaxSectionCode>(this.open());
    if (target.open) next.add(code);
    else next.delete(code);
    this.open.set(next);
  }

  protected asAmount(value: unknown): number {
    if (typeof value === 'number') return value;
    throw new Error(`amount cell expects a number, got ${typeof value}`);
  }

  protected download(): void {
    if (this.downloading()) return;
    const report: TaxReport = this.report();
    const locale: Locale = this.locale();
    this.downloading.set(true);
    this.downloadError.set(false);
    toTaxPdf({ report, labels: this.pdfLabels(report.year), locale })
      .then((blob: Blob): void => downloadBlob(blob, taxPdfFileName({ year: report.year, locale })))
      .catch((cause: unknown): void => {
        this.downloadError.set(true);
        throw cause;
      })
      .finally((): void => this.downloading.set(false));
  }

  private pdfLabels(year: number): TaxPdfLabels {
    return {
      title: this.i18n.t('tax.wizard.title', { year }),
      scope: this.store.transactions.accountsText(),
      generatedOn: this.i18n.t('tax.pdf.generatedOn', {
        date: new Intl.DateTimeFormat(this.locale(), { dateStyle: 'medium' }).format(new Date()),
      }),
      disclaimer: this.i18n.t('tax.disclaimer'),
      summary: this.i18n.t('tax.pdf.summary'),
      total: this.i18n.t('tax.pdf.total'),
      columns: {
        no: this.i18n.t('tax.result.colNo'),
        date: this.i18n.t('tax.result.colDate'),
        payee: this.i18n.t('tax.result.colPayee'),
        iban: this.i18n.t('tax.result.colIban'),
        purpose: this.i18n.t('tax.result.colPurpose'),
        category: this.i18n.t('tax.result.colCategory'),
        amount: this.i18n.t('tax.result.colAmount'),
        income: this.i18n.t('tax.result.income'),
        expenses: this.i18n.t('tax.result.expenses'),
        count: this.i18n.t('tax.result.payments'),
      },
      section: (section: TaxSection): TaxPdfSectionLabels => ({
        name: this.i18n.t(taxKey(section.nameKey)),
        form: this.i18n.t(taxKey(section.formKey)),
        note: this.i18n.t(guidanceKey(section, 'note')),
      }),
      page: (current: number, total: number): string =>
        this.i18n.t('tax.pdf.page', { current, total }),
    };
  }

  private pathOf(id: number): string {
    const path: string | undefined = this.store.transactions.categoryPathsById().get(id);
    if (path === undefined) throw new Error(`category ${id} has no path`);
    return path;
  }
}
