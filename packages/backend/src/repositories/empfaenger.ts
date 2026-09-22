import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '../db/pool';

export interface Payee {
  id: number;
  name: string;
  kontonummer: string | null;
  blz: string | null;
  iban: string | null;
  bic: string | null;
  bank: string | null;
  kategorie: string | null;
}

interface PayeeRow extends RowDataPacket {
  id: number;
  name: string;
  kontonummer: string | null;
  blz: string | null;
  iban: string | null;
  bic: string | null;
  bank: string | null;
  kategorie: string | null;
}

function toPayee(row: PayeeRow): Payee {
  return {
    id: row.id,
    name: row.name,
    kontonummer: row.kontonummer,
    blz: row.blz,
    iban: row.iban,
    bic: row.bic,
    bank: row.bank,
    kategorie: row.kategorie,
  };
}

export async function listPayees(q?: string): Promise<Payee[]> {
  const pool = getPool();
  const columns = 'id, name, kontonummer, blz, iban, bic, bank, kategorie';
  if (q === undefined || q.length === 0) {
    const [rows] = await pool.query<PayeeRow[]>(`SELECT ${columns} FROM empfaenger ORDER BY name`);
    return rows.map(toPayee);
  }

  const [rows] = await pool.query<PayeeRow[]>(
    `SELECT ${columns} FROM empfaenger WHERE name LIKE ? ORDER BY name`,
    [`%${q}%`],
  );
  return rows.map(toPayee);
}
