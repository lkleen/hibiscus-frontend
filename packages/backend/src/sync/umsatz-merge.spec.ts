import type { PoolConnection } from 'mysql2/promise';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchedBooking, MergeParams, MergeResult } from './fetched-booking';
import { computeChecksum, computeLegacyChecksum } from './hibiscus-checksum';
import { convertBooking, mergeStatement } from './umsatz-merge';
import type { UmsatzRow } from './umsatz-merge';

const KONTO_ID = 5;

function booking(overrides: Partial<FetchedBooking> = {}): FetchedBooking {
  return {
    bookingDate: '2026-07-15',
    valueDate: '2026-07-15',
    amount: -36.08,
    balanceAfter: 1000,
    bookingText: 'Lastschrift (Einzugsermaechtigung)',
    primanota: null,
    customerRef: 'NONREF',
    gvCode: '005',
    addKey: null,
    counterpartyAccount: 'DE00123456780000000000',
    counterpartyBlz: 'TESTDEFFXXX',
    counterpartyName: 'Muster GmbH',
    counterpartyName2: null,
    purposeLines: ['EREF+E2E-1', 'KREF+NONREF', 'SVWZ+Einkauf 42'],
    pending: false,
    ...overrides,
  };
}

/** A stored row as the desktop Hibiscus would have inserted it for `fetched`. */
interface StoredRow {
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
  checksum: number | null;
}

function stored(id: number, fetched: FetchedBooking, checksum?: number | null): StoredRow {
  const row: UmsatzRow = convertBooking(fetched, KONTO_ID);
  return {
    id,
    konto_id: KONTO_ID,
    art: row.art,
    betrag: row.betrag,
    customerref: row.customerref,
    empfaenger_blz: row.empfaengerBlz,
    empfaenger_konto: row.empfaengerKonto,
    empfaenger_name: row.empfaengerName,
    primanota: row.primanota,
    zweck: row.zweck,
    zweck2: row.zweck2,
    zweck3: row.zweck3,
    datum: row.datum,
    valuta: row.valuta,
    flags: row.flags,
    checksum: checksum === undefined ? computeChecksum(row) : checksum,
  };
}

/** Routes the merge's statements to an in-memory `umsatz` table. */
class FakeDatabase {
  rows: StoredRow[] = [];
  inserted: unknown[][] = [];
  statements: string[] = [];
  readonly query: ReturnType<typeof vi.fn> = vi.fn(
    async (sql: string, values: unknown[] = []): Promise<unknown[]> => this.run(sql, values),
  );

  private run(sql: string, values: unknown[]): unknown[] {
    const text: string = sql.replace(/\s+/g, ' ').trim();
    this.statements.push(text);
    if (text.startsWith('SELECT id FROM konto')) {
      return [values[0] === KONTO_ID ? [{ id: KONTO_ID }] : []];
    }
    if (text.startsWith('UPDATE konto') || text.startsWith('INSERT INTO protokoll')) {
      return [{ affectedRows: 1 }];
    }
    if (text.startsWith('INSERT INTO umsatz')) {
      this.inserted.push(values);
      return [{ affectedRows: 1 }];
    }
    if (text.startsWith('DELETE FROM umsatz')) {
      const ids: number[] = values[1] as number[];
      this.rows = this.rows.filter((row: StoredRow): boolean => !ids.includes(row.id));
      return [{ affectedRows: ids.length }];
    }
    if (text.includes('datum < CURDATE()')) {
      return [this.rows.filter((row: StoredRow): boolean => row.flags === 2 && row.datum < TODAY)];
    }
    if (text.includes('AND flags = ?')) {
      return [this.rows.filter((row: StoredRow): boolean => row.flags === values[1])];
    }
    if (text.includes('AND datum >= ?')) {
      return [this.rows.filter((row: StoredRow): boolean => row.datum >= (values[1] as string))];
    }
    throw new Error(`Unexpected statement: ${text}`);
  }

  /** The `checksum` and `flags` columns of every inserted row. */
  insertedChecksums(): unknown[] {
    return this.inserted.map((values: unknown[]): unknown => values[14]);
  }
}

const TODAY = '2026-07-20';

let db: FakeDatabase;

beforeEach(() => {
  db = new FakeDatabase();
});

function merge(params: Partial<MergeParams>): Promise<MergeResult> {
  return mergeStatement(db as unknown as PoolConnection, {
    kontoId: KONTO_ID,
    bookings: [],
    balance: null,
    ...params,
  });
}

describe('convertBooking', () => {
  it('maps an MT940 line like Converter.HBCIUmsatz2HibiscusUmsatz', () => {
    const row: UmsatzRow = convertBooking(
      booking({
        bookingText: 'Gut\r\nschrift',
        counterpartyBlz: 'GENODEF1S06 SVWZ+ ja',
        counterpartyName2: ' Zweigstelle ',
        addKey: '',
      }),
      KONTO_ID,
    );
    expect(row).toMatchObject({
      art: 'Gutschrift',
      empfaengerBlz: 'GENODEF1S06',
      empfaengerName: 'Muster GmbH Zweigstelle',
      zweck: 'EREF+E2E-1',
      zweck2: 'KREF+NONREF',
      zweck3: 'SVWZ+Einkauf 42\n',
      gvcode: '005',
      addkey: null,
      endtoendid: 'E2E-1',
      mandateid: null,
      saldo: 1000,
      flags: null,
    });
  });

  it('turns a missing name into null and takes ABWA, IBAN and BIC from the purpose', () => {
    const row: UmsatzRow = convertBooking(
      booking({
        counterpartyAccount: null,
        counterpartyBlz: null,
        counterpartyName: null,
        purposeLines: ['SVWZ+Test', 'ABWA+Anders', 'IBAN+DE89370400440532013000', 'BIC+COBADEFF'],
      }),
      KONTO_ID,
    );
    expect(row.empfaengerName).toBe('Anders');
    expect(row.empfaengerKonto).toBe('DE89370400440532013000');
    expect(row.empfaengerBlz).toBe('COBADEFFXXX');
  });

  it('keeps "" for an absent sub-field once any counterparty sub-field exists', () => {
    const row: UmsatzRow = convertBooking(
      booking({ counterpartyAccount: null, counterpartyBlz: null, counterpartyName: '' }),
      KONTO_ID,
    );
    expect(row.empfaengerKonto).toBe('');
    expect(row.empfaengerBlz).toBe('');
    expect(row.empfaengerName).toBeNull();
  });

  it('cuts an unstructured (GV code 999) text into 27-char lines and drops the code', () => {
    const row: UmsatzRow = convertBooking(
      booking({
        gvCode: '999',
        bookingText: null,
        counterpartyAccount: null,
        counterpartyBlz: null,
        counterpartyName: null,
        purposeLines: ['x'.repeat(30)],
      }),
      KONTO_ID,
    );
    expect(row.gvcode).toBeNull();
    expect([row.zweck, row.zweck2]).toEqual(['x'.repeat(27), 'xxx']);
  });

  it('marks pending bookings with flag 2 and saldo 0', () => {
    const row: UmsatzRow = convertBooking(booking({ pending: true, balanceAfter: null }), KONTO_ID);
    expect(row.flags).toBe(2);
    expect(row.saldo).toBe(0);
  });
});

describe('mergeStatement', () => {
  it('inserts new bookings with the Hibiscus checksum and logs the fetch', async () => {
    const fetched: FetchedBooking = booking();

    expect(await merge({ bookings: [fetched] })).toEqual({ inserted: 1, deleted: 0 });

    expect(db.insertedChecksums()).toEqual([computeChecksum(convertBooking(fetched, KONTO_ID))]);
    expect(db.query.mock.calls[0]?.[0]).toContain('FOR UPDATE');
    expect(db.query).toHaveBeenCalledWith(
      'INSERT INTO protokoll (konto_id, kommentar, datum, typ) VALUES (?, ?, NOW(), ?)',
      [KONTO_ID, 'Umsätze abgerufen', 1],
    );
  });

  it('inserts nothing when re-fetching stored rows', async () => {
    const first: FetchedBooking = booking();
    const second: FetchedBooking = booking({ amount: -6.5, purposeLines: ['SVWZ+Anderes'] });
    db.rows = [stored(1, first), stored(2, second)];

    expect(await merge({ bookings: [first, second] })).toEqual({ inserted: 0, deleted: 0 });
  });

  it('only compares against rows from the earliest fetched booking date on', async () => {
    const fetched: FetchedBooking = booking();
    db.rows = [stored(1, fetched)];

    await merge({ bookings: [fetched, booking({ bookingDate: '2026-07-01', amount: 1 })] });

    const select: string | undefined = db.statements.find((s: string): boolean =>
      s.includes('datum >= ?'),
    );
    expect(select).toContain('FOR UPDATE');
    expect(
      db.query.mock.calls.some(
        (call: unknown[]): boolean =>
          String(call[0]).includes('datum >= ?') && (call[1] as unknown[])[1] === '2026-07-01',
      ),
    ).toBe(true);
  });

  it('recognises a stored row by its computed checksum when none is stored', async () => {
    const fetched: FetchedBooking = booking();
    db.rows = [stored(1, fetched, null)];

    expect(await merge({ bookings: [fetched] })).toEqual({ inserted: 0, deleted: 0 });
  });

  it('recognises rows stored with the legacy windows-1252 checksum', async () => {
    const fetched: FetchedBooking = booking({ counterpartyName: 'Bäckerei Müller' });
    const legacy: number = computeLegacyChecksum(convertBooking(fetched, KONTO_ID));
    db.rows = [stored(1, fetched, legacy)];

    expect(await merge({ bookings: [fetched] })).toEqual({ inserted: 0, deleted: 0 });
  });

  it('inserts identical twin bookings that are not stored yet', async () => {
    expect(await merge({ bookings: [booking(), booking()] })).toEqual({
      inserted: 2,
      deleted: 0,
    });
  });

  it('skips twin bookings stored as often as they are fetched', async () => {
    db.rows = [stored(1, booking()), stored(2, booking())];

    expect(await merge({ bookings: [booking(), booking()] })).toEqual({
      inserted: 0,
      deleted: 0,
    });
  });

  it('keeps the Java counting: n stored twins absorb n + 1 fetched ones', async () => {
    db.rows = [stored(1, booking())];

    expect(await merge({ bookings: [booking(), booking()] })).toEqual({
      inserted: 0,
      deleted: 0,
    });
    expect(await merge({ bookings: [booking(), booking(), booking()] })).toEqual({
      inserted: 1,
      deleted: 0,
    });
  });

  it('inserts new pending bookings and deletes the ones no longer delivered', async () => {
    const kept: FetchedBooking = booking({ pending: true, balanceAfter: null, amount: -1 });
    const gone: FetchedBooking = booking({ pending: true, balanceAfter: null, amount: -2 });
    const added: FetchedBooking = booking({ pending: true, balanceAfter: null, amount: -3 });
    db.rows = [stored(10, kept), stored(11, gone)];

    expect(await merge({ bookings: [kept, added] })).toEqual({ inserted: 1, deleted: 1 });

    expect(db.rows.map((row: StoredRow): number => row.id)).toEqual([10]);
    const values: unknown[] = db.inserted[0] as unknown[];
    expect(values[10]).toBe(0); // saldo
    expect(values[15]).toBe(2); // flags
    expect(values[14]).toBe(computeChecksum(convertBooking(added, KONTO_ID)));
  });

  it('compares pending bookings only with stored pending rows', async () => {
    db.rows = [stored(1, booking())];

    expect(
      await merge({ bookings: [booking({ pending: true, balanceAfter: null })] }),
    ).toMatchObject({ inserted: 1 });
  });

  it('deletes stale pending rows when the bank delivers none', async () => {
    const old: FetchedBooking = booking({
      pending: true,
      balanceAfter: null,
      bookingDate: '2026-07-19',
    });
    const today: FetchedBooking = booking({
      pending: true,
      balanceAfter: null,
      bookingDate: TODAY,
    });
    db.rows = [stored(1, old), stored(2, today)];

    expect(await merge({ bookings: [booking({ bookingDate: TODAY })] })).toEqual({
      inserted: 1,
      deleted: 1,
    });
    expect(db.rows.map((row: StoredRow): number => row.id)).toEqual([2]);
  });

  it('updates the saldo, saldo_available and saldo_datum when a balance is given', async () => {
    await merge({ balance: { booked: 1234.56, available: 2000 } });

    expect(db.query).toHaveBeenCalledWith(
      'UPDATE konto SET saldo = ?, saldo_available = ?, saldo_datum = NOW() WHERE id = ?',
      [1234.56, 2000, KONTO_ID],
    );
    const protokoll: unknown[] = db.query.mock.calls
      .filter((call: unknown[]): boolean => String(call[0]).startsWith('INSERT INTO protokoll'))
      .map((call: unknown[]): unknown => (call[1] as unknown[])[1]);
    expect(protokoll).toEqual([
      'Saldo abgerufen',
      'Konto-Eigenschaften aktualisiert',
      'Umsätze abgerufen',
    ]);
  });

  it('leaves saldo_available alone when the bank sent none', async () => {
    await merge({ balance: { booked: 1, available: null } });

    expect(db.query).toHaveBeenCalledWith(
      'UPDATE konto SET saldo = ?, saldo_datum = NOW() WHERE id = ?',
      [1, KONTO_ID],
    );
  });

  it('throws on invalid input before writing anything', async () => {
    await expect(merge({ bookings: [booking({ balanceAfter: null })] })).rejects.toThrow(
      'no balanceAfter',
    );
    await expect(merge({ bookings: [booking({ bookingDate: '2026-02-30' })] })).rejects.toThrow(
      'not a valid yyyy-MM-dd date',
    );
    await expect(merge({ bookings: [booking({ gvCode: '999' })] })).rejects.toThrow('GV code 999');
    await expect(merge({ kontoId: 0 })).rejects.toThrow('Invalid konto id');
    expect(db.query).not.toHaveBeenCalled();
  });

  it('throws for an unknown konto', async () => {
    await expect(merge({ kontoId: 99 })).rejects.toThrow('Konto 99 does not exist');
  });

  it('drops a too long add key and creditor id like Hibiscus', async () => {
    await merge({
      bookings: [booking({ addKey: '1234', purposeLines: ['CRED+' + 'X'.repeat(36)] })],
    });

    const values: unknown[] = db.inserted[0] as unknown[];
    expect(values[17]).toBeNull(); // addkey
    expect(values[20]).toBeNull(); // creditorid
  });
});
