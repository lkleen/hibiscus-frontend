import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import type { DemoDataset } from './demo-dataset';

/**
 * A small hand-written dataset for the demo repository specs (independent of the generator):
 * two accounts, the category chain 1 ← 2 ← 3 with category 2 tagged `St-WK`, three transactions.
 */

function account(id: number, bezeichnung: string | null): AccountRow {
  return {
    id,
    kontonummer: `100${id}`,
    unterkonto: null,
    blz: '12030000',
    name: 'Tobias Testmann',
    bezeichnung,
    waehrung: 'EUR',
    saldo: 100,
    saldo_datum: '2026-11-06 00:00:00',
    iban: `DE0012030000000000100${id}`,
    bic: null,
    saldo_available: null,
    kategorie: null,
  };
}

function category(id: number, name: string, parentId: number | null): CategoryRow {
  return {
    id,
    name,
    nummer: null,
    pattern: null,
    isregex: 0,
    umsatztyp: 0,
    parent_id: parentId,
    color: null,
    customcolor: 0,
    kommentar: null,
    konto_id: null,
    konto_kategorie: null,
    flags: 0,
  };
}

function transaction(id: number, umsatztypId: number | null): TransactionRow {
  return {
    id,
    konto_id: 1,
    empfaenger_konto: null,
    empfaenger_blz: null,
    empfaenger_name: `Empfänger ${id}`,
    empfaenger_name2: null,
    betrag: -10 * id,
    zweck: `Zweck ${id}`,
    zweck2: null,
    zweck3: null,
    datum: `2026-11-0${id}`,
    valuta: `2026-11-0${id}`,
    saldo: 100 - 10 * id,
    art: null,
    gvcode: null,
    endtoendid: null,
    kommentar: null,
    purposecode: null,
    customerref: null,
    mandateid: null,
    creditorid: null,
    umsatztyp_id: umsatztypId,
    flags: 0,
  };
}

/** A fresh copy every call, so a spec can change it freely. */
export function createTestDataset(): DemoDataset {
  return {
    generatedAt: '2026-11-06',
    accounts: [account(2, 'Tagesgeld'), account(1, 'Girokonto')],
    categories: [
      category(1, 'Wohnen', null),
      category(2, 'Miete', 1),
      category(3, 'Nebenkosten', 2),
    ],
    transactions: [transaction(3, null), transaction(1, 2), transaction(2, null)],
    taxTags: [{ category_id: 2, code: 'St-WK' }],
  };
}
