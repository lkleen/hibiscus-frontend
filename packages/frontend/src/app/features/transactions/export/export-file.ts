import type { TableViewId } from '@hibiscus-frontend/shared/contracts/user-settings';
import type { DateRange } from '../../../core/utils/date-range';
import type { ExportFormat } from './export.model';

export interface ExportFileNameParams {
  readonly view: TableViewId;
  readonly range: DateRange | null;
  readonly format: ExportFormat;
}

/** E.g. `transactions-by-category_2026-01-01_2026-09-30.pdf`; an open end reads `open`. */
export function exportFileName(params: ExportFileNameParams): string {
  const { view, range, format }: ExportFileNameParams = params;
  const period: string =
    range === null || (range.from === null && range.to === null)
      ? 'all-dates'
      : `${range.from ?? 'open'}_${range.to ?? 'open'}`;
  return `${view}_${period}.${format}`;
}

/** Hands the blob to the browser as a download via a temporary link. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url: string = URL.createObjectURL(blob);
  const link: HTMLAnchorElement = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    URL.revokeObjectURL(url);
  }
}
