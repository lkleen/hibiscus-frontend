/** The file formats an export can be written as. */
export type ExportFormat = 'csv' | 'pdf' | 'json';

/** A cell's content: amounts stay numbers so every writer formats them for its medium. */
export type ExportCell = string | number | null;

export interface ExportColumn {
  readonly id: string;
  /** Already translated. */
  readonly header: string;
  readonly kind: 'text' | 'amount';
}

export interface ExportRow {
  readonly kind: 'category' | 'transaction' | 'total';
  /** Nesting depth, 0 = top level; indentation in CSV/PDF, nesting in JSON. */
  readonly level: number;
  /** One per `ExportDocument.columns`, in the same order. */
  readonly cells: readonly ExportCell[];
}

/** What the export covers, as shown to the user (already translated). */
export interface ExportScope {
  readonly period: string;
  readonly accounts: string;
  readonly search: string | null;
}

/** A format-neutral export: built from a view, then written by one of the export writers. */
export interface ExportDocument {
  /** Already translated. */
  readonly title: string;
  readonly scope: ExportScope;
  readonly columns: readonly ExportColumn[];
  readonly rows: readonly ExportRow[];
}

/** Category levels to include (1 = top level only), or `'all'` for every transaction too. */
export type ExportDepth = number | 'all';

export type PdfPaperFormat = 'a4' | 'a3' | 'a5' | 'letter' | 'legal';
export type PdfOrientation = 'portrait' | 'landscape';
/** How the PDF table is kept inside the printable width: shrink the font (wrapping text columns
 *  below the floor), wrap text columns at the base font size, or split columns across pages. */
export type PdfFit = 'shrink' | 'wrap' | 'split';

export interface PdfPageSetup {
  readonly format: PdfPaperFormat;
  readonly orientation: PdfOrientation;
  readonly fit: PdfFit;
}

export interface ExportOptions {
  readonly format: ExportFormat;
  /** Ignored by the list view. */
  readonly depth: ExportDepth;
  /** Only read for `format: 'pdf'`. */
  readonly page: PdfPageSetup;
}
