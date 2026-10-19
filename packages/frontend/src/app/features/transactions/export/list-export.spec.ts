import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import { dashFormatter } from '../../../shared/components/data-table/data-table.defaults';
import type {
  DataTableColDef,
  DataTableExportCell,
  DataTableExportSnapshot,
  DataTableVisibleColDef,
} from '../../../shared/components/data-table/data-table.model';
import { transaction } from '../testing/transaction-fixture';
import { buildListExport } from './list-export';
import type { ExportDocument, ExportScope } from './export.model';

const SCOPE: ExportScope = { period: '2026', accounts: 'All', search: 'x' };

const columns: DataTableVisibleColDef<TransactionRow, unknown>[] = [
  { colId: 'zweck', headerKey: 'transactions.colPurpose1' },
  { colId: 'betrag', headerKey: 'transactions.colAmount' },
  { colId: 'saldo', headerKey: 'transactions.colBalance' },
];

function snapshot(
  rows: TransactionRow[],
  cols: DataTableVisibleColDef<TransactionRow, unknown>[] = columns,
): DataTableExportSnapshot<TransactionRow> {
  return {
    columns: cols,
    rows,
    cell: (column: DataTableColDef<TransactionRow, unknown>, row: TransactionRow) => {
      const value: unknown = row[column.colId as keyof TransactionRow];
      const cell: DataTableExportCell = { value, formatted: dashFormatter(value) };
      return column.colId === 'betrag' ? { value, formatted: `€${String(value)}` } : cell;
    },
  };
}

function build(snap: DataTableExportSnapshot<TransactionRow>): ExportDocument {
  return buildListExport({
    snapshot: snap,
    labels: {
      title: 'List',
      scope: SCOPE,
      header: (column: DataTableVisibleColDef<TransactionRow, unknown>): string =>
        `h:${column.colId}`,
    },
  });
}

describe('buildListExport', () => {
  const doc: ExportDocument = build(
    snapshot([
      transaction({ id: 1, zweck: 'Rent', betrag: -500, saldo: 100 }),
      transaction({ id: 2, zweck: null, betrag: 3, saldo: null }),
    ]),
  );

  it('keeps the snapshot column order with kinds and headers', () => {
    expect(doc.columns).toEqual([
      { id: 'zweck', header: 'h:zweck', kind: 'text' },
      { id: 'betrag', header: 'h:betrag', kind: 'amount' },
      { id: 'saldo', header: 'h:saldo', kind: 'amount' },
    ]);
    expect(doc.title).toBe('List');
    expect(doc.scope).toBe(SCOPE);
  });

  it('keeps amounts numeric and turns the dash placeholder into null', () => {
    expect(doc.rows.map((row) => row.cells)).toEqual([
      ['Rent', -500, 100],
      [null, 3, null],
    ]);
  });

  it('exports flat transaction rows without a total', () => {
    expect(doc.rows.every((row) => row.kind === 'transaction' && row.level === 0)).toBe(true);
  });

  it('throws on a non-numeric amount value', () => {
    const bad: DataTableExportSnapshot<TransactionRow> = {
      columns,
      rows: [transaction()],
      cell: () => ({ value: 'x', formatted: 'x' }),
    };
    expect(() => build(bad)).toThrow(/needs a number/);
  });
});
