import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type {
  BankConnection,
  BankConnectionAccount,
  BankConnectionSettings,
  SyncPausedReason,
  SyncRunStatus,
} from '@hibiscus-frontend/shared/contracts/sync';
import { getPool } from '../db/pool';
import type { EncryptedSecret } from '../sync/credential-crypto';

interface ConnectionRow extends RowDataPacket {
  id: number;
  name: string;
  blz: string;
  fints_url: string;
  login_name: string;
  customer_id: string | null;
  pin_ciphertext: Buffer | null;
  pin_iv: Buffer | null;
  pin_tag: Buffer | null;
  tan_method: number | null;
  tan_media: string | null;
  banking_information: string | null;
  sync_interval_hours: number;
  enabled: number;
  paused_reason: SyncPausedReason | null;
  last_sync_at: string | null;
  last_status: SyncRunStatus | null;
  last_error: string | null;
}

interface AccountRow extends RowDataPacket {
  connection_id: number;
  account_identifier: string;
  konto_id: number;
  enabled: number;
}

interface IdRow extends RowDataPacket {
  id: number;
}

interface PinRow extends RowDataPacket {
  id: number;
  pin_ciphertext: Buffer;
  pin_iv: Buffer;
  pin_tag: Buffer;
}

interface KontoKeyRow extends RowDataPacket {
  id: number;
  iban: string | null;
  kontonummer: string;
}

/**
 * A connection as the sync service needs it: settings, the PIN encrypted with the user's key, and
 * the bank parameter data. `pin` is `null` after a key reset, until the user enters it again.
 */
export interface BankConnectionRecord {
  readonly id: number;
  readonly settings: BankConnectionSettings;
  readonly pin: EncryptedSecret | null;
  /** lib-fints `BankingInformation` as JSON; `null` before the first dialog. */
  readonly bankingInformation: string | null;
  readonly accounts: readonly BankConnectionAccount[];
}

/** Parameters of `reencryptBankConnectionPins`. */
export interface PinReencryption {
  /** Decrypts a PIN with the old key and encrypts it with the new one; throws on a wrong key. */
  readonly reencrypt: (pin: EncryptedSecret) => EncryptedSecret;
  /** Runs after every PIN is written and before the commit; a throw rolls the PINs back. */
  readonly beforeCommit: () => Promise<void>;
}

/** Parameters of `createBankConnection`. */
export interface BankConnectionCreateParams {
  readonly settings: BankConnectionSettings;
  readonly pin: EncryptedSecret;
}

/** Parameters of `updateBankConnection`. `pin`: only when it is replaced. */
export interface BankConnectionUpdateParams {
  readonly id: number;
  readonly expected: BankConnectionSettings;
  readonly next: BankConnectionSettings;
  readonly pin?: EncryptedSecret;
}

/** What a finished run writes into the connection's `last_*` columns. */
export interface BankConnectionOutcome {
  readonly status: SyncRunStatus;
  readonly error: string | null;
}

/** A konto's keys a discovered account is matched by. */
export interface KontoMatchKey {
  readonly id: number;
  readonly iban: string | null;
  readonly kontonummer: string;
}

export type BankConnectionWriteResult = 'updated' | 'conflict' | 'not-found';

const CONNECTION_COLUMNS = `id, name, blz, fints_url, login_name, customer_id, pin_ciphertext,
  pin_iv, pin_tag, tan_method, tan_media, banking_information, sync_interval_hours, enabled,
  paused_reason, last_sync_at, last_status, last_error`;

/** The fields whose change makes stored bank parameter data stale. */
const BANK_IDENTITY_FIELDS: (keyof BankConnectionSettings)[] = [
  'blz',
  'fintsUrl',
  'loginName',
  'customerId',
];

const SETTINGS_FIELDS: (keyof BankConnectionSettings)[] = [
  'name',
  'blz',
  'fintsUrl',
  'loginName',
  'customerId',
  'tanMethod',
  'tanMedia',
  'syncIntervalHours',
  'enabled',
];

function toSettings(row: ConnectionRow): BankConnectionSettings {
  return {
    name: row.name,
    blz: row.blz,
    fintsUrl: row.fints_url,
    loginName: row.login_name,
    customerId: row.customer_id,
    tanMethod: row.tan_method,
    tanMedia: row.tan_media,
    syncIntervalHours: row.sync_interval_hours,
    enabled: row.enabled === 1,
  };
}

function toAccount(row: AccountRow): BankConnectionAccount {
  return {
    accountIdentifier: row.account_identifier,
    kontoId: row.konto_id,
    enabled: row.enabled === 1,
  };
}

/** The settings as `UPDATE`/`INSERT` values, in `SETTINGS_SQL_COLUMNS` order. */
function settingsValues(settings: BankConnectionSettings): (string | number | null)[] {
  return [
    settings.name,
    settings.blz,
    settings.fintsUrl,
    settings.loginName,
    settings.customerId,
    settings.tanMethod,
    settings.tanMedia,
    settings.syncIntervalHours,
    settings.enabled ? 1 : 0,
  ];
}

const SETTINGS_SQL_COLUMNS: string[] = [
  'name',
  'blz',
  'fints_url',
  'login_name',
  'customer_id',
  'tan_method',
  'tan_media',
  'sync_interval_hours',
  'enabled',
];

function sameSettings(a: BankConnectionSettings, b: BankConnectionSettings): boolean {
  return SETTINGS_FIELDS.every((field: keyof BankConnectionSettings) => a[field] === b[field]);
}

async function listAccountRows(connectionId?: number): Promise<AccountRow[]> {
  const where: string = connectionId === undefined ? '' : 'WHERE connection_id = ?';
  const [rows] = await getPool().query<AccountRow[]>(
    `SELECT connection_id, account_identifier, konto_id, enabled
     FROM hf_bank_connection_account ${where}
     ORDER BY connection_id, account_identifier`,
    connectionId === undefined ? [] : [connectionId],
  );
  return rows;
}

/** Every connection ordered by name, without the PIN or bank parameter data. */
export async function listBankConnections(): Promise<BankConnection[]> {
  const [rows] = await getPool().query<ConnectionRow[]>(
    `SELECT ${CONNECTION_COLUMNS} FROM hf_bank_connection ORDER BY name, id`,
  );
  const accounts: AccountRow[] = await listAccountRows();
  return rows.map((row: ConnectionRow): BankConnection => ({
    id: row.id,
    ...toSettings(row),
    accounts: accounts
      .filter((account: AccountRow) => account.connection_id === row.id)
      .map(toAccount),
    pausedReason: row.paused_reason,
    lastSyncAt: row.last_sync_at,
    lastStatus: row.last_status,
    lastError: row.last_error,
  }));
}

/** One connection's API view, `null` when it does not exist. */
export async function getBankConnection(id: number): Promise<BankConnection | null> {
  const all: BankConnection[] = await listBankConnections();
  return all.find((connection: BankConnection) => connection.id === id) ?? null;
}

/** One connection with its encrypted PIN, `null` when it does not exist. */
export async function getBankConnectionRecord(id: number): Promise<BankConnectionRecord | null> {
  const [rows] = await getPool().query<ConnectionRow[]>(
    `SELECT ${CONNECTION_COLUMNS} FROM hf_bank_connection WHERE id = ?`,
    [id],
  );
  const row: ConnectionRow | undefined = rows[0];
  if (row === undefined) return null;
  const accounts: AccountRow[] = await listAccountRows(id);
  const pin: EncryptedSecret | null =
    row.pin_ciphertext === null || row.pin_iv === null || row.pin_tag === null
      ? null
      : { ciphertext: row.pin_ciphertext, iv: row.pin_iv, tag: row.pin_tag };
  return {
    id: row.id,
    settings: toSettings(row),
    pin,
    bankingInformation: row.banking_information,
    accounts: accounts.map(toAccount),
  };
}

/** Inserts a connection and returns its id. */
export async function createBankConnection(params: BankConnectionCreateParams): Promise<number> {
  const [result] = await getPool().query<ResultSetHeader>(
    `INSERT INTO hf_bank_connection
       (${SETTINGS_SQL_COLUMNS.join(', ')}, pin_ciphertext, pin_iv, pin_tag)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [...settingsValues(params.settings), params.pin.ciphertext, params.pin.iv, params.pin.tag],
  );
  return result.insertId;
}

async function writeUpdate(
  connection: PoolConnection,
  params: BankConnectionUpdateParams,
): Promise<void> {
  const assignments: string[] = SETTINGS_SQL_COLUMNS.map((column: string) => `${column} = ?`);
  const values: (string | number | null | Buffer)[] = settingsValues(params.next);
  if (params.pin !== undefined) {
    assignments.push('pin_ciphertext = ?', 'pin_iv = ?', 'pin_tag = ?');
    values.push(params.pin.ciphertext, params.pin.iv, params.pin.tag);
  }
  const identityChanged: boolean = BANK_IDENTITY_FIELDS.some(
    (field: keyof BankConnectionSettings) => params.expected[field] !== params.next[field],
  );
  if (identityChanged) assignments.push('banking_information = NULL');
  await connection.query(`UPDATE hf_bank_connection SET ${assignments.join(', ')} WHERE id = ?`, [
    ...values,
    params.id,
  ]);
}

/**
 * Changes a connection's settings (and PIN, when given) if it still holds `expected`; the row is
 * read `FOR UPDATE` and compared inside one transaction. A changed bank identity (BLZ, URL, login,
 * customer ID) drops the stored bank parameter data.
 */
export async function updateBankConnection(
  params: BankConnectionUpdateParams,
): Promise<BankConnectionWriteResult> {
  const connection: PoolConnection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<ConnectionRow[]>(
      `SELECT ${CONNECTION_COLUMNS} FROM hf_bank_connection WHERE id = ? FOR UPDATE`,
      [params.id],
    );
    const row: ConnectionRow | undefined = rows[0];
    let result: BankConnectionWriteResult = 'updated';
    if (row === undefined) result = 'not-found';
    else if (!sameSettings(toSettings(row), params.expected)) result = 'conflict';
    else await writeUpdate(connection, params);
    await connection.commit();
    return result;
  } catch (error: unknown) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/** Deletes a connection with its account mapping and runs; whether it existed. */
export async function deleteBankConnection(id: number): Promise<boolean> {
  const [result] = await getPool().query<ResultSetHeader>(
    'DELETE FROM hf_bank_connection WHERE id = ?',
    [id],
  );
  return result.affectedRows === 1;
}

/** Replaces a connection's whole account mapping in one transaction. */
export async function replaceBankConnectionAccounts(
  id: number,
  accounts: readonly BankConnectionAccount[],
): Promise<'updated' | 'not-found'> {
  const connection: PoolConnection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<IdRow[]>(
      'SELECT id FROM hf_bank_connection WHERE id = ? FOR UPDATE',
      [id],
    );
    if (rows.length === 0) {
      await connection.commit();
      return 'not-found';
    }
    await connection.query('DELETE FROM hf_bank_connection_account WHERE connection_id = ?', [id]);
    if (accounts.length > 0) {
      await connection.query(
        `INSERT INTO hf_bank_connection_account
           (connection_id, account_identifier, konto_id, enabled) VALUES ?`,
        [
          accounts.map((account: BankConnectionAccount) => [
            id,
            account.accountIdentifier,
            account.kontoId,
            account.enabled ? 1 : 0,
          ]),
        ],
      );
    }
    await connection.commit();
    return 'updated';
  } catch (error: unknown) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/** Stores lib-fints's bank parameter data (JSON) after a dialog. */
export async function saveBankingInformation(id: number, json: string): Promise<void> {
  await getPool().query('UPDATE hf_bank_connection SET banking_information = ? WHERE id = ?', [
    json,
    id,
  ]);
}

/** Records a finished run: `last_sync_at` = now, whatever the outcome. */
export async function recordBankConnectionOutcome(
  id: number,
  outcome: BankConnectionOutcome,
): Promise<void> {
  await getPool().query(
    `UPDATE hf_bank_connection SET last_sync_at = NOW(), last_status = ?, last_error = ?
     WHERE id = ?`,
    [outcome.status, outcome.error, id],
  );
}

/** Sets or clears (`null`) why the scheduler skips the connection. */
export async function setBankConnectionPaused(
  id: number,
  reason: SyncPausedReason | null,
): Promise<void> {
  await getPool().query('UPDATE hf_bank_connection SET paused_reason = ? WHERE id = ?', [
    reason,
    id,
  ]);
}

/**
 * Ids of the connections the scheduler runs now, ordered by id: enabled, not paused, with a PIN,
 * and never synced or last synced at least `sync_interval_hours` ago.
 */
export async function listDueBankConnectionIds(): Promise<number[]> {
  const [rows] = await getPool().query<IdRow[]>(
    `SELECT id FROM hf_bank_connection
     WHERE enabled = 1 AND paused_reason IS NULL AND pin_ciphertext IS NOT NULL
       AND (last_sync_at IS NULL
            OR last_sync_at + INTERVAL sync_interval_hours HOUR <= NOW())
     ORDER BY id`,
  );
  return rows.map((row: IdRow) => row.id);
}

/**
 * Re-encrypts every stored PIN under a new key in one transaction: the PINs are read `FOR UPDATE`,
 * each is passed through `reencrypt` and written back, then `beforeCommit` runs. Any throw rolls
 * all of them back, so the PINs are either all under the old key or all under the new one.
 * Returns how many PINs were re-encrypted.
 */
export async function reencryptBankConnectionPins(params: PinReencryption): Promise<number> {
  const connection: PoolConnection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<PinRow[]>(
      `SELECT id, pin_ciphertext, pin_iv, pin_tag FROM hf_bank_connection
       WHERE pin_ciphertext IS NOT NULL ORDER BY id FOR UPDATE`,
    );
    for (const row of rows) {
      const next: EncryptedSecret = params.reencrypt({
        ciphertext: row.pin_ciphertext,
        iv: row.pin_iv,
        tag: row.pin_tag,
      });
      await connection.query(
        'UPDATE hf_bank_connection SET pin_ciphertext = ?, pin_iv = ?, pin_tag = ? WHERE id = ?',
        [next.ciphertext, next.iv, next.tag, row.id],
      );
    }
    await params.beforeCommit();
    await connection.commit();
    return rows.length;
  } catch (error: unknown) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Deletes every stored PIN and disables the connections (after a key reset): a connection without
 * a PIN cannot sync until the user enters it again. Returns how many connections were affected.
 */
export async function clearBankConnectionPins(): Promise<number> {
  const [result] = await getPool().query<ResultSetHeader>(
    `UPDATE hf_bank_connection SET pin_ciphertext = NULL, pin_iv = NULL, pin_tag = NULL,
       enabled = 0`,
  );
  return result.affectedRows;
}

/** Every konto's id, IBAN and account number, for matching discovered accounts. */
export async function listKontoMatchKeys(): Promise<KontoMatchKey[]> {
  const [rows] = await getPool().query<KontoKeyRow[]>(
    'SELECT id, iban, kontonummer FROM konto ORDER BY id',
  );
  return rows.map((row: KontoKeyRow): KontoMatchKey => ({
    id: row.id,
    iban: row.iban,
    kontonummer: row.kontonummer,
  }));
}
