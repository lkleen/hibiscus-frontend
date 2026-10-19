import type {
  ExportCell,
  ExportColumn,
  ExportDocument,
  ExportRow,
  PdfPageSetup,
  PdfPaperFormat,
} from './export.model';

export const PDF_MARGIN_MM = 12;
export const PDF_BASE_FONT_PT = 9;
export const PDF_FLOOR_FONT_PT = 6;
/** Left plus right padding of a table cell. */
export const PDF_CELL_PADDING_MM = 2;
/** Narrowest a wrapping column may get before the layout gives up. */
const MIN_TEXT_COLUMN_MM = 8;
const MAX_SHRINK_ITERATIONS = 50;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const PAPER_MM: Readonly<Record<PdfPaperFormat, readonly [number, number]>> = {
  a5: [148, 210],
  a4: [210, 297],
  a3: [297, 420],
  letter: [215.9, 279.4],
  legal: [215.9, 355.6],
};

export interface PdfLayout {
  readonly pageWidthMm: number;
  readonly pageHeightMm: number;
  readonly marginMm: number;
  readonly fontSizePt: number;
  /** Indexed by column. */
  readonly columnWidthsMm: readonly number[];
  readonly wrapColumns: readonly boolean[];
  /** Column indices per horizontal page; column 0 leads every page. */
  readonly splitPages: readonly (readonly number[])[];
  /** True when even the floor font size does not fit and text columns had to wrap. */
  readonly hitsFloor: boolean;
}

export interface PlanPdfLayoutParams {
  readonly doc: ExportDocument;
  readonly page: PdfPageSetup;
  readonly locale: 'en' | 'de';
  /** Rendered width in mm of `text` at `fontSizePt`. */
  readonly measure: (text: string, fontSizePt: number, bold: boolean) => number;
}

export function pageSizeMm(page: PdfPageSetup): { widthMm: number; heightMm: number } {
  const [width, height]: readonly [number, number] = PAPER_MM[page.format];
  return page.orientation === 'portrait'
    ? { widthMm: width, heightMm: height }
    : { widthMm: height, heightMm: width };
}

/** The text a cell shows in the PDF; the first column is indented two spaces per level. */
export function pdfCellText(params: {
  cell: ExportCell;
  column: ExportColumn;
  row: ExportRow;
  columnIndex: number;
  locale: 'en' | 'de';
}): string {
  const { cell, column, row, columnIndex, locale } = params;
  let text: string;
  if (cell === null) text = '';
  else if (typeof cell === 'number') {
    if (!Number.isFinite(cell)) throw new Error(`Non-finite number in column ${column.id}`);
    text = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cell);
  } else text = cell;
  return columnIndex === 0 ? '  '.repeat(row.level) + text : text;
}

/** A cell text and whether it is drawn bold (header, category and total rows). */
interface StyledText {
  readonly text: string;
  readonly bold: boolean;
}

function columnTexts(params: PlanPdfLayoutParams): StyledText[][] {
  const { doc, locale }: PlanPdfLayoutParams = params;
  return doc.columns.map((column: ExportColumn, index: number): StyledText[] => [
    { text: column.header, bold: true },
    ...doc.rows.map((row: ExportRow): StyledText => ({
      text: pdfCellText({
        cell: row.cells[index] ?? null,
        column,
        row,
        columnIndex: index,
        locale,
      }),
      bold: row.kind !== 'transaction',
    })),
  ]);
}

function isFixedColumn(column: ExportColumn, doc: ExportDocument, index: number): boolean {
  if (column.kind === 'amount') return true;
  const cells: ExportCell[] = doc.rows
    .map((row: ExportRow): ExportCell => row.cells[index] ?? null)
    .filter((cell: ExportCell): boolean => cell !== null);
  return (
    cells.length > 0 &&
    cells.every((cell: ExportCell): boolean => typeof cell === 'string' && ISO_DATE.test(cell))
  );
}

/** Text columns never take more than this share of the printable width. */
const MAX_TEXT_SHARE = 0.35;
/** Longest unbreakable word a column reserves; longer tokens may be broken by the table. */
const MAX_MIN_WORD_MM = 25;

interface FitContext {
  readonly params: PlanPdfLayoutParams;
  readonly texts: readonly (readonly StyledText[])[];
  readonly fixed: readonly boolean[];
  readonly available: number;
}

interface Fitted {
  readonly fontSizePt: number;
  readonly widths: number[];
  readonly wrap: boolean[];
  readonly hitsFloor: boolean;
}

interface ColumnBounds {
  readonly natural: number[];
  readonly min: number[];
  /** Natural width, capped for text columns. */
  readonly max: number[];
}

function sum(values: readonly number[]): number {
  return values.reduce((total: number, value: number): number => total + value, 0);
}

function columnBounds(context: FitContext, fontSizePt: number): ColumnBounds {
  const { params, texts, fixed, available }: FitContext = context;
  const natural: number[] = [];
  const min: number[] = [];
  const max: number[] = [];
  texts.forEach((column: readonly StyledText[], index: number): void => {
    const width: number =
      Math.max(
        ...column.map((t: StyledText): number => params.measure(t.text, fontSizePt, t.bold)),
      ) + PDF_CELL_PADDING_MM;
    natural.push(width);
    if (fixed[index]) {
      min.push(width);
      max.push(width);
      return;
    }
    const indent: number = Math.max(
      ...column.map((t: StyledText): number => t.text.length - t.text.trimStart().length),
    );
    const longestWord: number = Math.max(
      ...column.flatMap((t: StyledText): number[] =>
        t.text
          .split(/\s+/)
          .filter((word: string): boolean => word !== '')
          .map((word: string): number => params.measure(word, fontSizePt, t.bold)),
      ),
      0,
    );
    const indentWidth: number =
      index === 0 ? params.measure(' '.repeat(indent), fontSizePt, false) : 0;
    const minWidth: number =
      Math.min(longestWord + indentWidth, MAX_MIN_WORD_MM) + PDF_CELL_PADDING_MM;
    min.push(Math.min(minWidth, width));
    max.push(Math.max(Math.min(width, MAX_TEXT_SHARE * available), min[index]));
  });
  return { natural, min, max };
}

/** CSS-auto-table style: max widths if they fit, else min plus a share of the slack. */
function allocate(context: FitContext, fontSizePt: number, hitsFloor: boolean): Fitted {
  const { fixed, available }: FitContext = context;
  const { natural, min, max }: ColumnBounds = columnBounds(context, fontSizePt);
  let widths: number[];
  if (sum(max) <= available) widths = max;
  else if (sum(min) <= available) {
    const slack: number = available - sum(min);
    const span: number = sum(max) - sum(min);
    widths = min.map((m: number, i: number): number => m + (slack * (max[i] - m)) / span);
  } else {
    const fixedSum: number = sum(min.filter((_: number, i: number): boolean => fixed[i]));
    const textMin: number = sum(min.filter((_: number, i: number): boolean => !fixed[i]));
    const textCount: number = fixed.filter((isFixed: boolean): boolean => !isFixed).length;
    const remaining: number = available - fixedSum;
    if (textCount === 0 || remaining < textCount * MIN_TEXT_COLUMN_MM) {
      throw new Error('The columns cannot be fitted on the page; choose a larger format or split');
    }
    widths = min.map((m: number, i: number): number => (fixed[i] ? m : (m * remaining) / textMin));
  }
  const wrap: boolean[] = widths.map(
    (width: number, i: number): boolean => !fixed[i] && width < natural[i] - 1e-6,
  );
  return { fontSizePt, widths, wrap, hitsFloor };
}

function fitShrink(context: FitContext): Fitted {
  let fontSizePt: number = PDF_BASE_FONT_PT;
  for (let i = 0; i < MAX_SHRINK_ITERATIONS; i++) {
    const total: number = sum(columnBounds(context, fontSizePt).max);
    if (total <= context.available) return allocate(context, fontSizePt, false);
    if (fontSizePt === PDF_FLOOR_FONT_PT) break;
    fontSizePt = Math.max(PDF_FLOOR_FONT_PT, (fontSizePt * context.available) / total);
  }
  const fits: boolean = sum(columnBounds(context, PDF_FLOOR_FONT_PT).max) <= context.available;
  return allocate(context, PDF_FLOOR_FONT_PT, !fits);
}

function fitWrap(context: FitContext): Fitted {
  return allocate(context, PDF_BASE_FONT_PT, false);
}

/** Column 0 repeats on every page; columns wider than their page share are capped and wrap. */
function fitSplit(context: FitContext): Fitted & { pages: number[][] } {
  const { available }: FitContext = context;
  const { natural, max }: ColumnBounds = columnBounds(context, PDF_BASE_FONT_PT);
  const count: number = max.length;
  const firstCap: number = count === 1 ? available : available / 2;
  const widths: number[] = [Math.min(max[0], firstCap)];
  for (let i = 1; i < count; i++) widths.push(Math.min(max[i], available - widths[0]));
  const wrap: boolean[] = widths.map(
    (width: number, i: number): boolean => !context.fixed[i] && width < natural[i] - 1e-6,
  );
  const pages: number[][] = [];
  let current: number[] = [0];
  let used: number = widths[0];
  for (let i = 1; i < count; i++) {
    if (used + widths[i] > available) {
      pages.push(current);
      current = [0];
      used = widths[0];
    }
    current.push(i);
    used += widths[i];
  }
  pages.push(current);
  return { fontSizePt: PDF_BASE_FONT_PT, widths, wrap, hitsFloor: false, pages };
}

/** Pure layout planning: sizes, font and page splits for the PDF table, independent of jsPDF. */
export function planPdfLayout(params: PlanPdfLayoutParams): PdfLayout {
  const { doc, page }: PlanPdfLayoutParams = params;
  if (doc.columns.length === 0) throw new Error('Cannot lay out a document without columns');
  const { widthMm, heightMm }: { widthMm: number; heightMm: number } = pageSizeMm(page);
  const available: number = widthMm - 2 * PDF_MARGIN_MM;
  const texts: StyledText[][] = columnTexts(params);
  const fixed: boolean[] = doc.columns.map((column: ExportColumn, i: number): boolean =>
    isFixedColumn(column, doc, i),
  );
  const base: Omit<
    PdfLayout,
    'fontSizePt' | 'columnWidthsMm' | 'wrapColumns' | 'splitPages' | 'hitsFloor'
  > = { pageWidthMm: widthMm, pageHeightMm: heightMm, marginMm: PDF_MARGIN_MM };
  const context: FitContext = { params, texts, fixed, available };
  const all: number[] = doc.columns.map((_: ExportColumn, i: number): number => i);

  switch (page.fit) {
    case 'shrink': {
      const fitted: Fitted = fitShrink(context);
      return { ...base, ...toLayout(fitted), splitPages: [all] };
    }
    case 'wrap': {
      const fitted: Fitted = fitWrap(context);
      return { ...base, ...toLayout(fitted), splitPages: [all] };
    }
    case 'split': {
      const fitted: Fitted & { pages: number[][] } = fitSplit(context);
      return { ...base, ...toLayout(fitted), splitPages: fitted.pages };
    }
    default: {
      const unreachable: never = page.fit;
      throw new Error(`Unknown PDF fit: ${String(unreachable)}`);
    }
  }
}

function toLayout(
  fitted: Fitted,
): Pick<PdfLayout, 'fontSizePt' | 'columnWidthsMm' | 'wrapColumns' | 'hitsFloor'> {
  return {
    fontSizePt: fitted.fontSizePt,
    columnWidthsMm: fitted.widths,
    wrapColumns: fitted.wrap,
    hitsFloor: fitted.hitsFloor,
  };
}
