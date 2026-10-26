import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import type { TaxSection } from '../../core/tax/tax-sections';
import type { TaxCategoryTotal, TaxReceipt, TaxReport, TaxSectionReport } from './tax-report';

type Locale = 'en' | 'de';

export interface TaxPdfSectionLabels {
  readonly name: string;
  readonly form: string;
  readonly note: string;
}

export interface TaxPdfLabels {
  /** e.g. 'Tax return 2025'. */
  readonly title: string;
  /** Accounts line, already translated. */
  readonly scope: string;
  /** Already formatted. */
  readonly generatedOn: string;
  readonly disclaimer: string;
  /** Summary heading. */
  readonly summary: string;
  readonly total: string;
  readonly columns: {
    readonly no: string;
    readonly date: string;
    readonly payee: string;
    readonly iban: string;
    readonly purpose: string;
    readonly category: string;
    readonly amount: string;
    readonly income: string;
    readonly expenses: string;
    readonly count: string;
  };
  readonly section: (section: TaxSection) => TaxPdfSectionLabels;
  readonly page: (current: number, total: number) => string;
}

export interface TaxPdfParams {
  readonly report: TaxReport;
  readonly labels: TaxPdfLabels;
  readonly locale: Locale;
}

const MARGIN_MM = 15;
const FOOTER_MM = 8;
const PT_TO_MM = 0.3528;
const TITLE_PT = 16;
const HEADING_PT = 12;
const TEXT_PT = 9;
const TABLE_PT = 7.5;
const SMALL_PT = 8;
const LINE_MM = 5;
const CELL_PADDING_MM = 1.2;
const DASH = '-';
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;

/** Receipt column widths in mm; they add up to the A4 content width (210 - 2 * MARGIN_MM). */
const RECEIPT_WIDTHS_MM: readonly number[] = [9, 18, 30, 38, 40, 25, 20];

interface AutoTableDoc {
  lastAutoTable?: { finalY: number };
}

interface CellDef {
  readonly content: string;
  readonly styles?: { readonly fontStyle?: 'bold' | 'normal'; readonly halign?: 'left' | 'right' };
}

function formatAmount(params: { readonly value: number; readonly locale: Locale }): string {
  return new Intl.NumberFormat(params.locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(params.value));
}

function formatDate(params: { readonly datum: string; readonly locale: Locale }): string {
  const match: RegExpExecArray | null = DATE_PATTERN.exec(params.datum);
  if (match === null) throw new Error(`invalid transaction date '${params.datum}'`);
  const [, year, month, day]: string[] = match;
  return params.locale === 'de' ? `${day}.${month}.${year}` : `${year}-${month}-${day}`;
}

function orDash(value: string | null): string {
  return value === null || value.trim() === '' ? DASH : value;
}

function cell(content: string, bold: boolean, right: boolean): CellDef {
  return {
    content,
    styles: { fontStyle: bold ? 'bold' : 'normal', halign: right ? 'right' : 'left' },
  };
}

function finalY(pdf: unknown): number {
  const last: AutoTableDoc['lastAutoTable'] = (pdf as AutoTableDoc).lastAutoTable;
  if (last === undefined) throw new Error('autoTable did not report the table end');
  return last.finalY;
}

function summaryBody(params: TaxPdfParams): CellDef[][] {
  const { report, labels, locale }: TaxPdfParams = params;
  const money = (value: number): string => formatAmount({ value, locale });
  const rows: CellDef[][] = [];
  let income = 0;
  let expenses = 0;
  let count = 0;
  for (const s of report.sections) {
    const text: TaxPdfSectionLabels = labels.section(s.section);
    rows.push([
      cell(`${text.form} – ${text.name}`, true, false),
      cell(money(s.income), true, true),
      cell(money(s.expenses), true, true),
      cell(String(s.count), true, true),
    ]);
    for (const c of s.categories) {
      rows.push([
        cell(`    ${c.path}`, false, false),
        cell(money(c.income), false, true),
        cell(money(c.expenses), false, true),
        cell(String(c.count), false, true),
      ]);
    }
    income += s.income;
    expenses += s.expenses;
    count += s.count;
  }
  rows.push([
    cell(labels.total, true, false),
    cell(money(income), true, true),
    cell(money(expenses), true, true),
    cell(String(count), true, true),
  ]);
  return rows;
}

function categoryPathOf(params: {
  readonly section: TaxSectionReport;
  readonly receipt: TaxReceipt;
}): string {
  const found: TaxCategoryTotal | undefined = params.section.categories.find(
    (c: TaxCategoryTotal) => c.category.id === params.receipt.category.id,
  );
  if (found === undefined) {
    throw new Error(`category ${params.receipt.category.id} is missing in its section`);
  }
  return found.path;
}

/** Renders the tax report as an A4 portrait PDF: summary page, then one receipt list per section. */
export async function toTaxPdf(params: TaxPdfParams): Promise<Blob> {
  const { report, labels, locale }: TaxPdfParams = params;
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const pdf: InstanceType<typeof jsPDF> = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });
  const pageWidth: number = pdf.internal.pageSize.getWidth();
  const pageHeight: number = pdf.internal.pageSize.getHeight();
  const contentWidth: number = pageWidth - 2 * MARGIN_MM;
  const margin: { top: number; left: number; right: number; bottom: number } = {
    top: MARGIN_MM,
    left: MARGIN_MM,
    right: MARGIN_MM,
    bottom: MARGIN_MM + FOOTER_MM,
  };

  pdf.setProperties({ title: labels.title });
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(TITLE_PT);
  let y: number = MARGIN_MM + TITLE_PT * PT_TO_MM;
  pdf.text(pdf.splitTextToSize(labels.title, contentWidth), MARGIN_MM, y);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(TEXT_PT);
  for (const line of [labels.scope, labels.generatedOn]) {
    y += LINE_MM;
    pdf.text(pdf.splitTextToSize(line, contentWidth), MARGIN_MM, y);
  }
  y += LINE_MM * 1.5;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(HEADING_PT);
  pdf.text(labels.summary, MARGIN_MM, y);

  autoTable(pdf, {
    startY: y + LINE_MM / 2,
    margin,
    tableWidth: contentWidth,
    styles: { fontSize: TEXT_PT, cellPadding: CELL_PADDING_MM, overflow: 'linebreak' },
    headStyles: { fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: contentWidth - 3 * 30 },
      1: { cellWidth: 30, halign: 'right' },
      2: { cellWidth: 30, halign: 'right' },
      3: { cellWidth: 30, halign: 'right' },
    },
    head: [
      [
        { content: labels.summary, styles: { halign: 'left' } },
        { content: labels.columns.income, styles: { halign: 'right' } },
        { content: labels.columns.expenses, styles: { halign: 'right' } },
        { content: labels.columns.count, styles: { halign: 'right' } },
      ],
    ],
    body: summaryBody(params),
  });

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(SMALL_PT);
  const disclaimer: string[] = pdf.splitTextToSize(labels.disclaimer, contentWidth);
  const disclaimerHeight: number = disclaimer.length * SMALL_PT * PT_TO_MM * 1.3;
  y = finalY(pdf) + LINE_MM;
  if (y + disclaimerHeight > pageHeight - margin.bottom) {
    pdf.addPage();
    y = MARGIN_MM;
  }
  pdf.text(disclaimer, MARGIN_MM, y);

  for (const s of report.sections) {
    const text: TaxPdfSectionLabels = labels.section(s.section);
    pdf.addPage();
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(HEADING_PT);
    let top: number = MARGIN_MM + HEADING_PT * PT_TO_MM;
    const heading: string[] = pdf.splitTextToSize(`${text.form} – ${text.name}`, contentWidth);
    pdf.text(heading, MARGIN_MM, top);
    top += (heading.length - 1) * HEADING_PT * PT_TO_MM * 1.2;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(SMALL_PT);
    const note: string[] = pdf.splitTextToSize(text.note, contentWidth);
    top += LINE_MM;
    pdf.text(note, MARGIN_MM, top);
    top += note.length * SMALL_PT * PT_TO_MM * 1.3;

    const columnStyles: Record<number, object> = {};
    RECEIPT_WIDTHS_MM.forEach((width: number, index: number): void => {
      columnStyles[index] = {
        cellWidth: width,
        overflow: 'linebreak',
        halign: index === 0 || index === RECEIPT_WIDTHS_MM.length - 1 ? 'right' : 'left',
      };
    });
    autoTable(pdf, {
      startY: top,
      margin,
      tableWidth: contentWidth,
      showHead: 'everyPage',
      styles: { fontSize: TABLE_PT, cellPadding: CELL_PADDING_MM / 2, overflow: 'linebreak' },
      headStyles: { fontStyle: 'bold' },
      columnStyles,
      head: [
        [
          labels.columns.no,
          labels.columns.date,
          labels.columns.payee,
          labels.columns.iban,
          labels.columns.purpose,
          labels.columns.category,
          labels.columns.amount,
        ],
      ],
      body: s.receipts.map((receipt: TaxReceipt): string[] => {
        const t: TransactionRow = receipt.transaction;
        return [
          String(receipt.no),
          formatDate({ datum: t.datum, locale }),
          orDash(t.empfaenger_name),
          orDash(t.empfaenger_konto),
          orDash(t.zweck),
          categoryPathOf({ section: s, receipt }),
          formatAmount({ value: t.betrag, locale }),
        ];
      }),
    });
  }

  const total: number = pdf.getNumberOfPages();
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(SMALL_PT);
  for (let current = 1; current <= total; current++) {
    pdf.setPage(current);
    const footerY: number = pageHeight - MARGIN_MM + FOOTER_MM / 2;
    pdf.text(labels.title, MARGIN_MM, footerY);
    pdf.text(labels.page(current, total), pageWidth - MARGIN_MM, footerY, { align: 'right' });
  }
  return pdf.output('blob');
}

/** 'steuer-<year>.pdf' for de, 'tax-return-<year>.pdf' for en. */
export function taxPdfFileName(params: { readonly year: number; readonly locale: Locale }): string {
  return `${params.locale === 'de' ? 'steuer' : 'tax-return'}-${params.year}.pdf`;
}
