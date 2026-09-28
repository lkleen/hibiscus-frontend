import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';

/** A fully populated transaction; override only what a test cares about. */
export function transaction(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: 1,
    konto_id: 1,
    empfaenger_konto: null,
    empfaenger_blz: null,
    empfaenger_name: null,
    empfaenger_name2: null,
    betrag: -12.5,
    zweck: null,
    zweck2: null,
    zweck3: null,
    datum: '2026-09-01',
    valuta: '2026-09-01',
    saldo: null,
    art: null,
    gvcode: null,
    endtoendid: null,
    umsatztyp_id: null,
    ...overrides,
  };
}

/** A fully populated account; override only what a test cares about. */
export function account(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    id: 1,
    kontonummer: '12345678',
    unterkonto: null,
    blz: '10000000',
    name: 'Jane Doe',
    bezeichnung: 'Checking',
    waehrung: 'EUR',
    saldo: 100,
    saldo_datum: '2026-09-01',
    iban: null,
    bic: 'TESTDEFF',
    saldo_available: null,
    kategorie: null,
    ...overrides,
  };
}
