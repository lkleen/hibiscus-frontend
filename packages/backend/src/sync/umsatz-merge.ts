import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { FetchedBooking, MergeParams, MergeResult, StatementBalance } from './fetched-booking';
import {
  applyPurpose,
  computeChecksum,
  computeLegacyChecksum,
  deleteWhitespace,
  FLAG_NOTBOOKED,
  getTag,
  isBlank,
  parseFixedWidth,
  parseTags,
  purposeToArray,
  rewrap,
  splitLines,
  trimToEmpty,
  USAGE_DB_MAXLENGTH,
} from './hibiscus-checksum';
import type { ChecksumFields, SepaTag, UmsatzPurpose } from './hibiscus-checksum';

/**
 * A TypeScript port of how Hibiscus stores fetched MT940 bookings: the conversion of one booking
 * line into an `umsatz` row (`Converter.HBCIUmsatz2HibiscusUmsatz`, MT940 branch) and the merge
 * against the rows already stored (`HBCIUmsatzJob.markExecuted`). Port of Hibiscus master,
 * https://github.com/willuhn/hibiscus.
 */

/** `Protokoll.TYP_SUCCESS` */
const PROTOKOLL_TYP_SUCCESS = 1;

/** `HBCIProperties.HBCI_TRANSFER_NAME_MAXLENGTH` (default) */
const NAME_MAXLENGTH = 70;

/** `HBCIProperties.HBCI_SEPA_CREDITORID_MAXLENGTH` (default) */
const CREDITORID_MAXLENGTH = 35;

/** `HBCIProperties.HBCI_GVCODE_MAXLENGTH` / `HBCI_ADDKEY_MAXLENGTH` (defaults) */
const GVCODE_MAXLENGTH = 3;

/** `HBCIProperties.HBCI_BIC_VALIDCHARS` (default) */
const BIC_PATTERN = /^[A-Z0-9]+$/;

/** A converted booking: every `umsatz` column this app writes. */
export interface UmsatzRow extends ChecksumFields {
  saldo: number;
  gvcode: string | null;
  addkey: string | null;
  endtoendid: string | null;
  mandateid: string | null;
  creditorid: string | null;
}

/** The columns of an existing row needed to recognise it again. */
interface ExistingUmsatzRow extends RowDataPacket {
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
  checksum: number | string | null;
}

/** An existing row and the checksum `UmsatzImpl.getChecksum` reports for it. */
interface ExistingUmsatz {
  id: number;
  checksum: number;
}

/** A converted booking and the checksums it is recognised by. */
interface ConvertedUmsatz {
  row: UmsatzRow;
  checksum: number;
  legacyChecksum: number;
}

// ---------------------------------------------------------------------------------------------
// Validation

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function assertIsoDate(value: string, field: string): void {
  const match: RegExpExecArray | null = ISO_DATE.exec(value);
  const date: Date = new Date(`${value}T00:00:00Z`);
  if (!match || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${field} "${value}" is not a valid yyyy-MM-dd date`);
  }
}

function assertFinite(value: number, field: string): void {
  if (!Number.isFinite(value)) throw new Error(`${field} ${value} is not a finite number`);
}

function assertBooking(booking: FetchedBooking, index: number): void {
  const at = `booking ${index}`;
  assertIsoDate(booking.bookingDate, `${at} bookingDate`);
  assertIsoDate(booking.valueDate, `${at} valueDate`);
  assertFinite(booking.amount, `${at} amount`);
  if (!booking.pending) {
    // hbci4java computes a running balance for every MT940 line; Hibiscus stores it in `saldo`.
    if (booking.balanceAfter === null) throw new Error(`${at} is booked but has no balanceAfter`);
    assertFinite(booking.balanceAfter, `${at} balanceAfter`);
  }
  if (booking.gvCode === '999') {
    // hbci4java leaves these unset for an unstructured `:86:` (`GVRKUms.UmsLine.additional`).
    const structured: (string | null)[] = [
      booking.bookingText,
      booking.primanota,
      booking.addKey,
      booking.counterpartyAccount,
      booking.counterpartyBlz,
      booking.counterpartyName,
      booking.counterpartyName2,
    ];
    if (structured.some((value: string | null): boolean => value !== null)) {
      throw new Error(`${at} has GV code 999 but carries structured :86: sub-fields`);
    }
  }
}

function assertParams(params: MergeParams): void {
  if (!Number.isInteger(params.kontoId) || params.kontoId <= 0) {
    throw new Error(`Invalid konto id ${params.kontoId}`);
  }
  params.bookings.forEach((booking: FetchedBooking, index: number): void =>
    assertBooking(booking, index),
  );
  if (params.balance !== null) {
    assertFinite(params.balance.booked, 'balance.booked');
    if (params.balance.available !== null) {
      assertFinite(params.balance.available, 'balance.available');
    }
  }
}

/** `HBCIProperties.checkLength`, which `UmsatzImpl.insertCheck` applies before every insert. */
function assertMaxLength(value: string | null, max: number, field: string): void {
  if (value !== null && value.length > max) {
    throw new Error(`${field} is ${value.length} chars long, at most ${max} allowed: "${value}"`);
  }
}

/** `UmsatzImpl.insertCheck` */
function assertInsertable(row: UmsatzRow): void {
  assertMaxLength(row.zweck, 255, 'zweck');
  assertMaxLength(row.zweck2, USAGE_DB_MAXLENGTH, 'zweck2');
  for (const line of splitLines(row.zweck3)) assertMaxLength(line, USAGE_DB_MAXLENGTH, 'zweck3');
  assertMaxLength(row.gvcode, GVCODE_MAXLENGTH, 'gvcode');
  assertMaxLength(row.addkey, GVCODE_MAXLENGTH, 'addkey');
  assertMaxLength(row.creditorid, CREDITORID_MAXLENGTH, 'creditorid');
}

// ---------------------------------------------------------------------------------------------
// Converter.HBCIUmsatz2HibiscusUmsatz

/** `Converter.clean`: strips line breaks (`HBCIProperties.TEXT_REPLACEMENTS_UMSATZ`). */
function cleanText(text: string | null): string | null {
  return text === null ? null : text.replaceAll('\n', '').replaceAll('\r', '');
}

/** `Converter.cleanSepaId` */
function cleanSepaId(text: string | null): string | null {
  const cleaned: string | null = cleanText(text);
  if (cleaned === null || cleaned.length <= 100) return cleaned;
  const space: number = cleaned.indexOf(' ');
  const cut: string = space > 0 && space < 100 ? cleaned.substring(0, space) : cleaned;
  return cut.length > 100 ? cut.substring(0, 100) : cut;
}

/** The EREF/MREF/CRED extraction of `Converter.HBCIUmsatz2HibiscusUmsatz` (MT940 branch). */
function sepaId(purpose: UmsatzPurpose, tag: SepaTag, maxLength: number): string | null {
  const value: string | null = cleanSepaId(getTag(purpose, tag));
  return value !== null && value.length > 0 && value.length <= maxLength ? value : null;
}

/** Mod-97 check of ISO 13616. */
function isValidIban(iban: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged: string = iban.substring(4) + iban.substring(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const digits: string = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55);
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

/**
 * `IbanCommonsProperties.getIBAN`: the IBAN from a purpose tag, or null if invalid. Hibiscus also
 * runs the German national check digit (kontocheck) on DE IBANs; that is not ported.
 */
function parseIban(text: string): string | null {
  if (isBlank(text)) return null;
  const iban: string = deleteWhitespace(text);
  return isValidIban(iban) ? iban : null;
}

/** `HBCIProperties.checkBIC`: 8 or 11 valid chars, 8 completed with "XXX"; null if invalid. */
function checkBic(bic: string): string | null {
  if (!BIC_PATTERN.test(bic) || (bic.length !== 8 && bic.length !== 11)) return null;
  return bic.length === 8 ? `${bic}XXX` : bic;
}

interface Counterparty {
  konto: string | null;
  blz: string | null;
  name: string | null;
}

/**
 * hbci4java's `GVRKUms` builds `other` when any of `?30`-`?33` is present (missing parts become
 * ""), then `Converter.HBCIKonto2Address` (MT940: name + " " + name2, max 70 chars) and
 * `UmsatzImpl.setGegenkonto` (IBAN/BIC win over account/BLZ — the same sub-fields in MT940).
 */
function counterpartyFromSubfields(booking: FetchedBooking): Counterparty {
  const present: boolean = [
    booking.counterpartyBlz,
    booking.counterpartyAccount,
    booking.counterpartyName,
    booking.counterpartyName2,
  ].some((value: string | null): boolean => value !== null);
  if (!present) return { konto: null, blz: null, name: null };
  let blz: string = booking.counterpartyBlz ?? '';
  // GVRKUms: "GENODEF1S06 SVWZ+ ja" in ?30 is cut at the first space.
  const space: number = blz.indexOf(' ');
  if (space !== -1) blz = blz.substring(0, space);
  let name: string = trimToEmpty(booking.counterpartyName);
  const name2: string = trimToEmpty(booking.counterpartyName2);
  if (name2.length > 0) name += ` ${name2}`;
  if (name.length > NAME_MAXLENGTH) name = trimToEmpty(name.substring(0, NAME_MAXLENGTH));
  return { konto: booking.counterpartyAccount ?? '', blz, name };
}

/**
 * The `HBCI_SEPA_PARSE_TAGS` block of `Converter.HBCIUmsatz2HibiscusUmsatz`: counterparty parts
 * still missing are taken from the ABWA/IBAN/BIC purpose tags. Hibiscus can also derive a missing
 * BIC from a tagged IBAN via its bank directory (`BankDataLookup.byIban`); that is not ported.
 */
function completeCounterparty(counterparty: Counterparty, purpose: UmsatzPurpose): Counterparty {
  const haveIban = !isBlank(counterparty.konto);
  const haveBic = !isBlank(counterparty.blz);
  const haveName = !isBlank(counterparty.name);
  if (haveIban && haveBic && haveName) return counterparty;
  const tags: Map<SepaTag, string> = parseTags(purposeToArray(purpose));
  const result: Counterparty = { ...counterparty };
  if (!haveName) result.name = tags.get('ABWA') ?? null;
  const ibanTag: string | undefined = tags.get('IBAN');
  if (!haveIban && ibanTag !== undefined) {
    const iban: string | null = parseIban(ibanTag);
    if (iban !== null) result.konto = iban;
  }
  if (!haveBic) {
    const bicTag: string = trimToEmpty(tags.get('BIC'));
    const bic: string | null = bicTag.length > 0 ? checkBic(bicTag) : null;
    if (bic !== null) result.blz = bic;
  }
  return result;
}

/** `Converter.HBCIUmsatz2HibiscusUmsatz` (MT940 branch) plus the flags/saldo set by the job. */
export function convertBooking(booking: FetchedBooking, kontoId: number): UmsatzRow {
  const unstructured: boolean = booking.gvCode === '999';
  const delivered: string[] = unstructured
    ? parseFixedWidth(booking.purposeLines.join(''))
    : booking.purposeLines;
  const purpose: UmsatzPurpose = applyPurpose(rewrap(USAGE_DB_MAXLENGTH, delivered));
  const counterparty: Counterparty = completeCounterparty(
    counterpartyFromSubfields(booking),
    purpose,
  );
  const gvcode: string | null =
    booking.gvCode !== null && !unstructured && booking.gvCode.length <= GVCODE_MAXLENGTH
      ? booking.gvCode
      : null;
  const addkey: string | null =
    booking.addKey !== null &&
    booking.addKey.length > 0 &&
    booking.addKey.length <= GVCODE_MAXLENGTH
      ? booking.addKey
      : null;
  return {
    kontoId,
    art: cleanText(booking.bookingText),
    betrag: booking.amount,
    customerref: cleanText(booking.customerRef),
    empfaengerBlz: counterparty.blz,
    empfaengerKonto: counterparty.konto,
    empfaengerName: counterparty.name,
    primanota: cleanText(booking.primanota),
    ...purpose,
    datum: booking.bookingDate,
    valuta: booking.valueDate,
    // HBCIUmsatzJob: pending rows get FLAG_NOTBOOKED and saldo 0, booked rows no flags.
    flags: booking.pending ? FLAG_NOTBOOKED : null,
    saldo: booking.pending ? 0 : (booking.balanceAfter as number),
    gvcode,
    addkey,
    endtoendid: sepaId(purpose, 'EREF', 100),
    mandateid: sepaId(purpose, 'MREF', 100),
    creditorid: sepaId(purpose, 'CRED', CREDITORID_MAXLENGTH),
  };
}

function convert(booking: FetchedBooking, kontoId: number): ConvertedUmsatz {
  const row: UmsatzRow = convertBooking(booking, kontoId);
  return { row, checksum: computeChecksum(row), legacyChecksum: computeLegacyChecksum(row) };
}

// ---------------------------------------------------------------------------------------------
// Database access

const EXISTING_COLUMNS = `id, konto_id, art, betrag, customerref, empfaenger_blz,
  empfaenger_konto, empfaenger_name, primanota, zweck, zweck2, zweck3, datum, valuta, flags,
  checksum`;

/**
 * `UmsatzImpl.getChecksum` for a stored row: the checksum stored on insert, or — when it is null
 * or 0 — the one computed from the row now.
 */
function toExisting(row: ExistingUmsatzRow): ExistingUmsatz {
  const stored: number = row.checksum === null ? 0 : Number(row.checksum);
  if (!Number.isSafeInteger(stored)) throw new Error(`umsatz ${row.id} has checksum ${stored}`);
  if (stored !== 0) return { id: row.id, checksum: stored };
  const checksum: number = computeChecksum({
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
  });
  return { id: row.id, checksum };
}

/**
 * Reads with `FOR UPDATE`: a locking read sees the latest committed rows even if the caller's
 * transaction already holds an older REPEATABLE READ snapshot, so a merge that waited for the
 * konto lock sees what the merge before it inserted.
 */
async function selectExisting(
  conn: PoolConnection,
  sql: string,
  values: (string | number)[],
): Promise<ExistingUmsatz[]> {
  const [rows] = await conn.query<ExistingUmsatzRow[]>(`${sql} FOR UPDATE`, values);
  return rows.map(toExisting);
}

async function insertUmsatz(conn: PoolConnection, umsatz: ConvertedUmsatz): Promise<void> {
  const row: UmsatzRow = umsatz.row;
  assertInsertable(row);
  // `UmsatzImpl.insert` stores the checksum once, so later edits never change it.
  await conn.query<ResultSetHeader>(
    `INSERT INTO umsatz (konto_id, empfaenger_konto, empfaenger_blz, empfaenger_name, betrag,
       zweck, zweck2, zweck3, datum, valuta, saldo, primanota, art, customerref, checksum, flags,
       gvcode, addkey, endtoendid, mandateid, creditorid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.kontoId,
      row.empfaengerKonto,
      row.empfaengerBlz,
      row.empfaengerName,
      row.betrag,
      row.zweck,
      row.zweck2,
      row.zweck3,
      row.datum,
      row.valuta,
      row.saldo,
      row.primanota,
      row.art,
      row.customerref,
      umsatz.checksum,
      row.flags,
      row.gvcode,
      row.addkey,
      row.endtoendid,
      row.mandateid,
      row.creditorid,
    ],
  );
}

/** `KontoImpl.addToProtokoll`; `ProtokollImpl.insertCheck` sets `datum` to now. */
async function addToProtokoll(
  conn: PoolConnection,
  kontoId: number,
  kommentar: string,
): Promise<void> {
  await conn.query<ResultSetHeader>(
    'INSERT INTO protokoll (konto_id, kommentar, datum, typ) VALUES (?, ?, NOW(), ?)',
    [kontoId, kommentar, PROTOKOLL_TYP_SUCCESS],
  );
}

/**
 * `HBCISaldoJob.markExecuted`: `KontoImpl.setSaldo` (also sets `saldo_datum` to now),
 * `setSaldoAvailable` only when the bank sent one, and the protocol entries of the saldo job and
 * of `KontoImpl.store`.
 */
async function updateSaldo(
  conn: PoolConnection,
  kontoId: number,
  balance: StatementBalance,
): Promise<void> {
  await addToProtokoll(conn, kontoId, 'Saldo abgerufen');
  const [result] =
    balance.available === null
      ? await conn.query<ResultSetHeader>(
          'UPDATE konto SET saldo = ?, saldo_datum = NOW() WHERE id = ?',
          [balance.booked, kontoId],
        )
      : await conn.query<ResultSetHeader>(
          'UPDATE konto SET saldo = ?, saldo_available = ?, saldo_datum = NOW() WHERE id = ?',
          [balance.booked, balance.available, kontoId],
        );
  if (result.affectedRows !== 1) {
    throw new Error(`Updating the saldo of konto ${kontoId} affected ${result.affectedRows} rows`);
  }
  await addToProtokoll(conn, kontoId, 'Konto-Eigenschaften aktualisiert');
}

// ---------------------------------------------------------------------------------------------
// HBCIUmsatzJob.markExecuted

/**
 * `UmsatzImpl.equals` for a fetched booking (no id, no txid in MT940) against a stored row:
 * equal checksums. A stored windows-1252 checksum of an older desktop installation counts too
 * (see `computeLegacyChecksum`) — Hibiscus itself would miss those and insert the booking again.
 */
function isSame(existing: ExistingUmsatz, fetched: ConvertedUmsatz): boolean {
  return existing.checksum === fetched.checksum || existing.checksum === fetched.legacyChecksum;
}

/**
 * The duplicate counting of `HBCIUmsatzJob.markExecuted`, ported as is: a fetched booking is
 * skipped while the same booking (keyed by the last matching stored row) has been seen at most as
 * often as it is stored. Note the Java `<=`: with n identical rows stored, n + 1 identical
 * fetched bookings are all skipped; only the (n + 2)-th is inserted.
 */
async function mergeInto(
  conn: PoolConnection,
  existing: ExistingUmsatz[],
  fetched: ConvertedUmsatz[],
): Promise<number> {
  const seen: Map<number, number> = new Map<number, number>();
  let inserted = 0;
  for (const umsatz of fetched) {
    const matches: ExistingUmsatz[] = existing.filter((row: ExistingUmsatz): boolean =>
      isSame(row, umsatz),
    );
    const fromDb: ExistingUmsatz | undefined = matches[matches.length - 1];
    if (fromDb !== undefined) {
      const count: number | undefined = seen.get(fromDb.id);
      if (count === undefined || count <= matches.length) {
        seen.set(fromDb.id, (count ?? 0) + 1);
        continue;
      }
    }
    await insertUmsatz(conn, umsatz);
    inserted++;
  }
  return inserted;
}

/** The earliest booking date of the batch (`HBCIUmsatzJob.getMergeWindow`). */
function mergeWindowStart(bookings: FetchedBooking[]): string {
  const dates: string[] = bookings.map((booking: FetchedBooking): string => booking.bookingDate);
  const earliest: string | undefined = dates.sort()[0];
  if (earliest === undefined) throw new Error('No bookings to derive a merge window from');
  return earliest;
}

/** The booked part of `HBCIUmsatzJob.markExecuted`. */
async function mergeBooked(conn: PoolConnection, params: MergeParams): Promise<number> {
  const booked: FetchedBooking[] = params.bookings.filter(
    (booking: FetchedBooking): boolean => !booking.pending,
  );
  if (booked.length === 0) return 0;
  // `KontoImpl.getUmsaetze(start, null)`: every row of the konto from the window on, pending
  // rows included. The window starts at the earliest booked *or* pending booking date.
  const existing: ExistingUmsatz[] = await selectExisting(
    conn,
    `SELECT ${EXISTING_COLUMNS} FROM umsatz WHERE konto_id = ? AND datum >= ? ORDER BY datum DESC, id DESC`,
    [params.kontoId, mergeWindowStart(params.bookings)],
  );
  const fetched: ConvertedUmsatz[] = booked.map((booking: FetchedBooking): ConvertedUmsatz =>
    convert(booking, params.kontoId),
  );
  return mergeInto(conn, existing, fetched);
}

async function deletePending(conn: PoolConnection, rows: ExistingUmsatz[]): Promise<number> {
  if (rows.length === 0) return 0;
  const ids: number[] = rows.map((row: ExistingUmsatz): number => row.id);
  const [result] = await conn.query<ResultSetHeader>(
    'DELETE FROM umsatz WHERE flags = ? AND id IN (?)',
    [FLAG_NOTBOOKED, ids],
  );
  if (result.affectedRows !== ids.length) {
    throw new Error(`Deleting ${ids.length} pending umsatz rows deleted ${result.affectedRows}`);
  }
  return ids.length;
}

/** The pending ("vorgemerkt") part of `HBCIUmsatzJob.markExecuted`. */
async function mergePending(
  conn: PoolConnection,
  params: MergeParams,
): Promise<{ inserted: number; deleted: number }> {
  const pending: FetchedBooking[] = params.bookings.filter(
    (booking: FetchedBooking): boolean => booking.pending,
  );
  if (pending.length === 0) {
    // No pending bookings delivered: drop every stored pending row dated before today.
    const stale: ExistingUmsatz[] = await selectExisting(
      conn,
      `SELECT ${EXISTING_COLUMNS} FROM umsatz WHERE konto_id = ? AND flags = ? AND datum < CURDATE()`,
      [params.kontoId, FLAG_NOTBOOKED],
    );
    return { inserted: 0, deleted: await deletePending(conn, stale) };
  }
  // Compared against all stored pending rows, not only the window: the ones the bank no longer
  // delivers have been booked meanwhile and are deleted.
  const existing: ExistingUmsatz[] = await selectExisting(
    conn,
    `SELECT ${EXISTING_COLUMNS} FROM umsatz WHERE konto_id = ? AND flags = ? ORDER BY datum DESC, id DESC`,
    [params.kontoId, FLAG_NOTBOOKED],
  );
  const fetched: ConvertedUmsatz[] = pending.map((booking: FetchedBooking): ConvertedUmsatz =>
    convert(booking, params.kontoId),
  );
  const inserted: number = await mergeInto(conn, existing, fetched);
  const obsolete: ExistingUmsatz[] = existing.filter(
    (row: ExistingUmsatz): boolean =>
      !fetched.some((umsatz: ConvertedUmsatz): boolean => isSame(row, umsatz)),
  );
  return { inserted, deleted: await deletePending(conn, obsolete) };
}

/**
 * Stores one fetched statement of a konto like Hibiscus does after a successful HKKAZ: the saldo
 * (when given), the protocol entry, new booked rows, and the pending rows replaced. Runs inside
 * the transaction the caller opened on `conn`; it neither begins nor commits.
 */
export async function mergeStatement(
  conn: PoolConnection,
  params: MergeParams,
): Promise<MergeResult> {
  assertParams(params);
  // Locks the konto row for the rest of the caller's transaction, so two merges of the same konto
  // run one after the other instead of both inserting the same bookings.
  const [konto] = await conn.query<RowDataPacket[]>(
    'SELECT id FROM konto WHERE id = ? FOR UPDATE',
    [params.kontoId],
  );
  if (konto.length !== 1) throw new Error(`Konto ${params.kontoId} does not exist`);
  if (params.balance !== null) await updateSaldo(conn, params.kontoId, params.balance);
  await addToProtokoll(conn, params.kontoId, 'Umsätze abgerufen');
  const insertedBooked: number = await mergeBooked(conn, params);
  const pending: { inserted: number; deleted: number } = await mergePending(conn, params);
  return { inserted: insertedBooked + pending.inserted, deleted: pending.deleted };
}
