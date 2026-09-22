import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '../db/pool';

export interface Account {
  id: number;
  kontonummer: string;
  unterkonto: string | null;
  blz: string;
  name: string;
  bezeichnung: string | null;
  waehrung: string;
  saldo: number | null;
  saldoDatum: string | null;
  iban: string | null;
  bic: string | null;
  saldoAvailable: number | null;
  kategorie: string | null;
}

interface AccountRow extends RowDataPacket {
  id: number;
  kontonummer: string;
  unterkonto: string | null;
  blz: string;
  name: string;
  bezeichnung: string | null;
  waehrung: string;
  saldo: number | null;
  saldo_datum: string | null;
  iban: string | null;
  bic: string | null;
  saldo_available: number | null;
  kategorie: string | null;
}

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    kontonummer: row.kontonummer,
    unterkonto: row.unterkonto,
    blz: row.blz,
    name: row.name,
    bezeichnung: row.bezeichnung,
    waehrung: row.waehrung,
    saldo: row.saldo,
    saldoDatum: row.saldo_datum,
    iban: row.iban,
    bic: row.bic,
    saldoAvailable: row.saldo_available,
    kategorie: row.kategorie,
  };
}

export async function listAccounts(): Promise<Account[]> {
  const pool = getPool();
  const [rows] = await pool.query<AccountRow[]>(
    `SELECT id, kontonummer, unterkonto, blz, name, bezeichnung, waehrung, saldo, saldo_datum,
            iban, bic, saldo_available, kategorie
     FROM konto
     ORDER BY name`,
  );
  return rows.map(toAccount);
}
