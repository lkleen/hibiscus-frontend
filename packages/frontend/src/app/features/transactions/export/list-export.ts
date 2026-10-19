import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import type {
  DataTableExportCell,
  DataTableExportSnapshot,
  DataTableVisibleColDef,
} from '../../../shared/components/data-table/data-table.model';
import { dashFormatter } from '../../../shared/components/data-table/data-table.defaults';
import type { ExportCell, ExportColumn, ExportDocument, ExportScope } from './export.model';

const AMOUNT_COLUMNS: ReadonlySet<string> = new Set<string>(['betrag', 'saldo']);

export interface ListExportLabels {
  readonly title: string;
  readonly scope: ExportScope;
  readonly header: (column: DataTableVisibleColDef<TransactionRow, unknown>) => string;
}

export interface ListExportParams {
  readonly snapshot: DataTableExportSnapshot<TransactionRow>;
  readonly labels: ListExportLabels;
}

/** Turns the transactions list as currently shown (columns, filters, order) into an export. */
export function buildListExport(params: ListExportParams): ExportDocument {
  const { snapshot, labels } = params;
  const columns: ExportColumn[] = snapshot.columns.map(
    (column: DataTableVisibleColDef<TransactionRow, unknown>): ExportColumn => ({
      id: column.colId,
      header: labels.header(column),
      kind: AMOUNT_COLUMNS.has(column.colId) ? 'amount' : 'text',
    }),
  );
  const dash: string = dashFormatter(null);
  return {
    title: labels.title,
    scope: labels.scope,
    columns,
    rows: snapshot.rows.map((row: TransactionRow) => ({
      kind: 'transaction' as const,
      level: 0,
      cells: snapshot.columns.map(
        (column: DataTableVisibleColDef<TransactionRow, unknown>): ExportCell => {
          const cell: DataTableExportCell = snapshot.cell(column, row);
          if (AMOUNT_COLUMNS.has(column.colId)) {
            if (cell.value === null || typeof cell.value === 'number') return cell.value;
            throw new Error(
              `list export: column "${column.colId}" needs a number, got ${typeof cell.value}`,
            );
          }
          return cell.formatted === dash ? null : cell.formatted;
        },
      ),
    })),
  };
}
