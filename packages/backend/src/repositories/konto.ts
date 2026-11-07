import type { RowDataPacket } from 'mysql2/promise';
import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import { getPool } from '../db/pool';

type AccountRowPacket = AccountRow & RowDataPacket;

/** Read access to Hibiscus's `konto` table. */
export interface AccountRepository {
  /** Every account, ordered by `bezeichnung`, then `id`. */
  list(): Promise<AccountRow[]>;
}

export class MysqlAccountRepository implements AccountRepository {
  async list(): Promise<AccountRow[]> {
    const pool = getPool();
    const [rows] = await pool.query<AccountRowPacket[]>(
      `SELECT id, kontonummer, unterkonto, blz, name, bezeichnung, waehrung, saldo, saldo_datum,
              iban, bic, saldo_available, kategorie
       FROM konto
       ORDER BY bezeichnung, id`,
    );
    return rows;
  }
}
