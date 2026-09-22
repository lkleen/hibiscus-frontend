import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '../db/pool';

export interface Transaction {
  id: number;
  kontoId: number;
  empfaengerKonto: string | null;
  empfaengerBlz: string | null;
  empfaengerName: string | null;
  empfaengerName2: string | null;
  betrag: number;
  zweck: string | null;
  zweck2: string | null;
  zweck3: string | null;
  datum: string;
  valuta: string;
  saldo: number | null;
  umsatztypId: number | null;
}

export interface TransactionFilter {
  accountId?: number;
  from?: string;
  to?: string;
  /** `null` filters for uncategorized transactions; `undefined` applies no category filter. */
  categoryId?: number | null;
  /** Free-text search over `zweck` and `empfaenger_name`. */
  q?: string;
  limit: number;
  offset: number;
}

export interface TransactionListResult {
  items: Transaction[];
  total: number;
}

interface TransactionRow extends RowDataPacket {
  id: number;
  konto_id: number;
  empfaenger_konto: string | null;
  empfaenger_blz: string | null;
  empfaenger_name: string | null;
  empfaenger_name2: string | null;
  betrag: number;
  zweck: string | null;
  zweck2: string | null;
  zweck3: string | null;
  datum: string;
  valuta: string;
  saldo: number | null;
  umsatztyp_id: number | null;
}

interface CountRow extends RowDataPacket {
  total: number;
}

function toTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    kontoId: row.konto_id,
    empfaengerKonto: row.empfaenger_konto,
    empfaengerBlz: row.empfaenger_blz,
    empfaengerName: row.empfaenger_name,
    empfaengerName2: row.empfaenger_name2,
    betrag: row.betrag,
    zweck: row.zweck,
    zweck2: row.zweck2,
    zweck3: row.zweck3,
    datum: row.datum,
    valuta: row.valuta,
    saldo: row.saldo,
    umsatztypId: row.umsatztyp_id,
  };
}

interface WhereClause {
  sql: string;
  params: (string | number)[];
}

function buildWhereClause(filter: TransactionFilter): WhereClause {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filter.accountId !== undefined) {
    conditions.push('konto_id = ?');
    params.push(filter.accountId);
  }
  if (filter.from !== undefined) {
    conditions.push('datum >= ?');
    params.push(filter.from);
  }
  if (filter.to !== undefined) {
    conditions.push('datum <= ?');
    params.push(filter.to);
  }
  if (filter.categoryId === null) {
    conditions.push('umsatztyp_id IS NULL');
  } else if (filter.categoryId !== undefined) {
    conditions.push('umsatztyp_id = ?');
    params.push(filter.categoryId);
  }
  if (filter.q !== undefined) {
    conditions.push('(zweck LIKE ? OR empfaenger_name LIKE ?)');
    const pattern = `%${filter.q}%`;
    params.push(pattern, pattern);
  }

  const sql = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
  return { sql, params };
}

export async function listTransactions(filter: TransactionFilter): Promise<TransactionListResult> {
  const pool = getPool();
  const where = buildWhereClause(filter);

  const [countRows] = await pool.query<CountRow[]>(
    `SELECT COUNT(*) AS total FROM umsatz${where.sql}`,
    where.params,
  );
  const total = countRows[0]?.total ?? 0;

  const [rows] = await pool.query<TransactionRow[]>(
    `SELECT id, konto_id, empfaenger_konto, empfaenger_blz, empfaenger_name, empfaenger_name2,
            betrag, zweck, zweck2, zweck3, datum, valuta, saldo, umsatztyp_id
     FROM umsatz${where.sql}
     ORDER BY datum DESC, id DESC
     LIMIT ? OFFSET ?`,
    [...where.params, filter.limit, filter.offset],
  );

  return { items: rows.map(toTransaction), total };
}

export async function updateTransactionCategory(
  id: number,
  categoryId: number | null,
): Promise<void> {
  const pool = getPool();
  await pool.query(`UPDATE umsatz SET umsatztyp_id = ? WHERE id = ?`, [categoryId, id]);
}
