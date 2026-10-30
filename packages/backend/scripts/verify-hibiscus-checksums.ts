/**
 * Local golden check for the Hibiscus checksum port: recomputes `UmsatzImpl.getChecksum` for every
 * `umsatz` row and compares it with the checksum the desktop Hibiscus stored on insert.
 *
 * Run from packages/backend against the local dev MariaDB, never against production data:
 *
 *   set -a && . ../../.env.dev.local && set +a && \
 *     pnpm exec ts-node-dev --transpile-only scripts/verify-hibiscus-checksums.ts
 *
 * It reads only the DB_* variables, so it does not go through `loadConfig()` (which also demands
 * the server's secrets), and opens its own short-lived connection instead of the app's pool.
 */
import mysql from 'mysql2/promise';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import {
  checksumSource,
  computeChecksum,
  computeLegacyChecksum,
} from '../src/sync/hibiscus-checksum';

interface UmsatzChecksumRow extends RowDataPacket {
  id: number;
  konto_id: number;
  art: string | null;
  betrag: number;
  customerref: string | null;
  empfaenger_blz: string | null;
  empfaenger_konto: string | null;
  empfaenger_name: string | null;
  primanota: string | null;
  zweck: string | null;
  zweck2: string | null;
  zweck3: string | null;
  datum: string;
  valuta: string;
  flags: number | null;
  checksum: string | null;
}

function requireEnv(name: string): string {
  const value: string | undefined = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const connection: Connection = await mysql.createConnection({
    host: requireEnv('DB_HOST'),
    port: Number(requireEnv('DB_PORT')),
    database: requireEnv('DB_NAME'),
    user: requireEnv('DB_USER'),
    password: requireEnv('DB_PASSWORD'),
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
  try {
    const [rows] = await connection.query<UmsatzChecksumRow[]>(
      `SELECT id, konto_id, art, betrag, customerref, empfaenger_blz, empfaenger_konto,
              empfaenger_name, primanota, zweck, zweck2, zweck3, datum, valuta, flags, checksum
       FROM umsatz ORDER BY id`,
    );
    if (rows.length === 0) {
      console.log('No umsatz rows in the database - import a dump first.');
      return;
    }
    let matches = 0;
    let legacyMatches = 0;
    let withoutStored = 0;
    const mismatches: string[] = [];
    for (const row of rows) {
      if (row.checksum === null || row.checksum === '0') {
        withoutStored++;
        continue;
      }
      const fields: Parameters<typeof computeChecksum>[0] = {
        kontoId: row.konto_id,
        art: row.art,
        betrag: Number(row.betrag),
        customerref: row.customerref,
        empfaengerBlz: row.empfaenger_blz,
        empfaengerKonto: row.empfaenger_konto,
        empfaengerName: row.empfaenger_name,
        primanota: row.primanota,
        zweck: row.zweck,
        zweck2: row.zweck2,
        zweck3: row.zweck3,
        datum: row.datum,
        valuta: row.valuta,
        flags: row.flags,
      };
      const computed: number = computeChecksum(fields);
      if (String(computed) === row.checksum) {
        matches++;
      } else if (String(computeLegacyChecksum(fields)) === row.checksum) {
        legacyMatches++;
      } else {
        mismatches.push(
          `id=${row.id} datum=${row.datum} stored=${row.checksum} computed=${computed} ` +
            `source=${JSON.stringify(checksumSource(fields))}`,
        );
      }
    }
    const compared: number = matches + legacyMatches + mismatches.length;
    console.log(`rows: ${rows.length}, without stored checksum: ${withoutStored}`);
    console.log(
      `compared: ${compared}, UTF-8 matches: ${matches}, windows-1252 matches: ${legacyMatches}, ` +
        `mismatches: ${mismatches.length}`,
    );
    // A row edited after it was inserted keeps its original checksum (Hibiscus stores it once,
    // in `UmsatzImpl.insert`), so a few mismatches on edited rows are expected.
    for (const sample of mismatches.slice(0, 20)) console.log(sample);
    process.exitCode = mismatches.length === 0 ? 0 : 1;
  } finally {
    await connection.end();
  }
}

main().catch((error: unknown): void => {
  console.error(error);
  process.exitCode = 1;
});
