import type {
  ExportCell,
  ExportColumn,
  ExportDocument,
  ExportRow,
  ExportScope,
  PdfPageSetup,
} from './export.model';
import { PDF_CELL_PADDING_MM, pdfCellText, planPdfLayout } from './pdf-layout';
import type { PdfLayout } from './pdf-layout';

type Locale = 'en' | 'de';

export interface CsvOptions {
  readonly locale: Locale;
  /** Header of the leading nesting-level column (already translated). */
  readonly levelHeader: string;
}

export interface PdfOptions {
  readonly locale: Locale;
  readonly page: PdfPageSetup;
  readonly labels: { readonly page: (current: number, total: number) => string };
}

export interface JsonRow {
  readonly kind: ExportRow['kind'];
  readonly cells: Record<string, ExportCell>;
  children?: JsonRow[];
}

const BOM = '\uFEFF';

function csvField(value: string, separator: string): string {
  return value.includes(separator) || /["\r\n]/.test(value)
    ? `"${value.replaceAll('"', '""')}"`
    : value;
}

function csvCell(params: {
  cell: ExportCell;
  column: ExportColumn;
  row: ExportRow;
  index: number;
  locale: Locale;
}): string {
  const { cell, column, row, index, locale }: typeof params = params;
  if (cell === null) return '';
  let text: string;
  if (typeof cell === 'number') {
    if (!Number.isFinite(cell)) throw new Error(`Non-finite number in column ${column.id}`);
    text = cell.toFixed(2);
    if (locale === 'de') text = text.replace('.', ',');
  } else text = cell;
  return index === 0 ? '  '.repeat(row.level) + text : text;
}

export function toCsv(doc: ExportDocument, options: CsvOptions): Blob {
  const separator: string = options.locale === 'de' ? ';' : ',';
  const lines: string[] = [
    [options.levelHeader, ...doc.columns.map((column: ExportColumn): string => column.header)]
      .map((field: string): string => csvField(field, separator))
      .join(separator),
  ];
  for (const row of doc.rows) {
    const fields: string[] = [String(row.level)];
    doc.columns.forEach((column: ExportColumn, index: number): void => {
      const cell: ExportCell | undefined = row.cells[index];
      if (cell === undefined) throw new Error(`Row is missing a cell for column ${column.id}`);
      fields.push(
        csvField(csvCell({ cell, column, row, index, locale: options.locale }), separator),
      );
    });
    lines.push(fields.join(separator));
  }
  return new Blob([BOM + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
}

export function toJson(doc: ExportDocument, exportedAt: Date): Blob {
  const roots: JsonRow[] = [];
  const stack: JsonRow[] = [];
  for (const row of doc.rows) {
    if (!Number.isInteger(row.level) || row.level < 0 || row.level > stack.length) {
      throw new Error(`Row level ${row.level} jumps more than one level below ${stack.length - 1}`);
    }
    const cells: Record<string, ExportCell> = {};
    doc.columns.forEach((column: ExportColumn, index: number): void => {
      const cell: ExportCell | undefined = row.cells[index];
      if (cell === undefined) throw new Error(`Row is missing a cell for column ${column.id}`);
      cells[column.id] = cell;
    });
    const node: JsonRow = { kind: row.kind, cells };
    stack.length = row.level;
    if (row.level === 0) roots.push(node);
    else {
      const parent: JsonRow = stack[row.level - 1];
      (parent.children ??= []).push(node);
    }
    stack.push(node);
  }
  const payload: object = {
    title: doc.title,
    scope: doc.scope,
    exportedAt: exportedAt.toISOString(),
    columns: doc.columns,
    rows: roots,
  };
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
}

function scopeLines(scope: ExportScope): string[] {
  const lines: string[] = [scope.period, scope.accounts];
  if (scope.search !== null) lines.push(scope.search);
  if (scope.taxSections !== undefined) lines.push(scope.taxSections);
  return lines;
}

const TITLE_PT = 14;
const SCOPE_PT = 9;
const LINE_MM = 4.5;
const FOOTER_MM = 6;

/** The generated PDF and the layout it was planned with (e.g. to warn when it hits the floor). */
export interface PdfResult {
  readonly blob: Blob;
  readonly layout: PdfLayout;
}

export async function toPdf(doc: ExportDocument, options: PdfOptions): Promise<PdfResult> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const pdf: InstanceType<typeof jsPDF> = new jsPDF({
    orientation: options.page.orientation,
    unit: 'mm',
    format: options.page.format,
  });
  const layout: PdfLayout = planPdfLayout({
    doc,
    page: options.page,
    locale: options.locale,
    measure: (text: string, fontSizePt: number, bold: boolean): number => {
      pdf.setFont('helvetica', bold ? 'bold' : 'normal');
      pdf.setFontSize(fontSizePt);
      const width: number = pdf.getTextWidth(text);
      pdf.setFont('helvetica', 'normal');
      return width;
    },
  });

  pdf.setProperties({ title: doc.title });
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(TITLE_PT);
  let y: number = layout.marginMm + TITLE_PT * 0.3528;
  pdf.text(doc.title, layout.marginMm, y);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(SCOPE_PT);
  for (const line of scopeLines(doc.scope)) {
    y += LINE_MM;
    pdf.text(line, layout.marginMm, y);
  }
  const startY: number = y + LINE_MM;

  layout.splitPages.forEach((columns: readonly number[], pageIndex: number): void => {
    if (pageIndex > 0) pdf.addPage();
    autoTable(pdf, {
      startY: pageIndex === 0 ? startY : layout.marginMm,
      margin: {
        top: layout.marginMm,
        left: layout.marginMm,
        right: layout.marginMm,
        bottom: layout.marginMm + FOOTER_MM,
      },
      tableWidth: 'wrap',
      showHead: 'everyPage',
      styles: {
        fontSize: layout.fontSizePt,
        cellPadding: PDF_CELL_PADDING_MM / 2,
        overflow: 'visible',
      },
      headStyles: { fontStyle: 'bold', overflow: 'linebreak' },
      columnStyles: Object.fromEntries(
        columns.map((column: number, position: number): [number, object] => [
          position,
          {
            cellWidth: layout.columnWidthsMm[column],
            overflow: layout.wrapColumns[column] ? 'linebreak' : 'visible',
            halign: doc.columns[column].kind === 'amount' ? 'right' : 'left',
          },
        ]),
      ),
      head: [columns.map((column: number): string => doc.columns[column].header)],
      body: doc.rows.map((row: ExportRow) =>
        columns.map((column: number) => ({
          content: pdfCellText({
            cell: row.cells[column] ?? null,
            column: doc.columns[column],
            row,
            columnIndex: column,
            locale: options.locale,
          }),
          styles: { fontStyle: row.kind === 'transaction' ? 'normal' : 'bold' },
        })),
      ),
    });
  });

  const total: number = pdf.getNumberOfPages();
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(SCOPE_PT);
  for (let current = 1; current <= total; current++) {
    pdf.setPage(current);
    pdf.text(
      options.labels.page(current, total),
      layout.pageWidthMm / 2,
      layout.pageHeightMm - layout.marginMm,
      { align: 'center' },
    );
  }
  return { blob: pdf.output('blob'), layout };
}
