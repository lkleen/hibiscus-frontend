import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type {
  TransactionColumn,
  TransactionUpdateRequest,
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
  'kommentar',
  'purposecode',
  'customerref',
  'mandateid',
  'creditorid',
  'umsatztyp_id',
  'flags',
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

export type TransactionUpdateResult = 'updated' | 'not-found' | 'conflict';

/**
 * Changes `kommentar` and `umsatztyp_id` of one row — no other column is ever written. The
 * `WHERE` clause also requires the row to still hold `expected` (`<=>` is NULL-safe), so a stale
 * edit matches nothing instead of overwriting a newer change: check and write are one atomic
 * statement. A foreign key violation (unknown category) is thrown to the caller.
 */
export async function updateTransaction(
  id: number,
  request: TransactionUpdateRequest,
): Promise<TransactionUpdateResult> {
  const pool = getPool();
  const { expected, next } = request;
  // mysql2 connects with the FOUND_ROWS client flag by default (`getDefaultFlags` in
  // mysql2/lib/connection_config.js) and the pool sets no override, so `affectedRows` counts rows
  // *matched* by the `WHERE`, not rows changed: `expected === next` still yields 1.
  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE umsatz SET kommentar = ?, umsatztyp_id = ?
     WHERE id = ? AND kommentar <=> ? AND umsatztyp_id <=> ?`,
    [next.kommentar, next.umsatztyp_id, id, expected.kommentar, expected.umsatztyp_id],
  );
  if (result.affectedRows === 1) return 'updated';
  if (result.affectedRows !== 0) {
    throw new Error(`Updating umsatz ${id} affected ${result.affectedRows} rows`);
  }
  // Nothing matched: either the row is gone or it no longer holds `expected`.
  const [existing] = await pool.query<RowDataPacket[]>('SELECT 1 FROM umsatz WHERE id = ?', [id]);
  return existing.length === 0 ? 'not-found' : 'conflict';
}
