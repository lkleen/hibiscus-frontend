import type { RowDataPacket } from 'mysql2/promise';
import type {
  TransactionColumn,
  TransactionValue,
  TransactionsResponse,
} from '@hibiscus-frontend/shared/contracts/transactions';
import { getPool } from '../db/pool';

type TransactionValuesPacket = TransactionValue[] & RowDataPacket;

/** The selected `umsatz` columns, in response order — both the `SELECT` list and `columns`. */
export const TRANSACTION_COLUMNS: TransactionColumn[] = [
  'id',
  'konto_id',
  'empfaenger_konto',
  'empfaenger_blz',
  'empfaenger_name',
  'empfaenger_name2',
  'betrag',
  'zweck',
  'zweck2',
  'zweck3',
  'datum',
  'valuta',
  'saldo',
  'art',
  'gvcode',
  'endtoendid',
  'umsatztyp_id',
];

export async function listTransactions(): Promise<TransactionsResponse> {
  const pool = getPool();
  // `rowsAsArray` makes the driver return each row as its values in `SELECT` order, so the
  // response needs no per-row mapping. `ORDER BY id` only makes the response deterministic; the
  // order the user sees is the grid's.
  const [rows] = await pool.query<TransactionValuesPacket[]>({
    sql: `SELECT ${TRANSACTION_COLUMNS.join(', ')} FROM umsatz ORDER BY id`,
    rowsAsArray: true,
  });
  return { columns: TRANSACTION_COLUMNS, rows };
}

export async function updateTransactionCategory(
  id: number,
  categoryId: number | null,
): Promise<void> {
  const pool = getPool();
  await pool.query(`UPDATE umsatz SET umsatztyp_id = ? WHERE id = ?`, [categoryId, id]);
}
