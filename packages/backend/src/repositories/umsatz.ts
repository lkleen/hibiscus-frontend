import type { RowDataPacket } from 'mysql2/promise';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import { getPool } from '../db/pool';

type TransactionRowPacket = TransactionRow & RowDataPacket;

export async function listTransactions(): Promise<TransactionRow[]> {
  const pool = getPool();
  // `ORDER BY id` only makes the response deterministic; the order the user sees is the grid's.
  const [rows] = await pool.query<TransactionRowPacket[]>(
    `SELECT id, konto_id, empfaenger_konto, empfaenger_blz, empfaenger_name, empfaenger_name2,
            betrag, zweck, zweck2, zweck3, datum, valuta, saldo, art, gvcode, endtoendid,
            umsatztyp_id
     FROM umsatz
     ORDER BY id`,
  );
  return rows;
}

export async function updateTransactionCategory(
  id: number,
  categoryId: number | null,
): Promise<void> {
  const pool = getPool();
  await pool.query(`UPDATE umsatz SET umsatztyp_id = ? WHERE id = ?`, [categoryId, id]);
}
