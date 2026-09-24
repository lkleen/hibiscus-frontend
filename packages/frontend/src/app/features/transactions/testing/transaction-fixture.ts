import { signal } from '@angular/core';
import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import type { Category } from '../../../core/models/category.model';
import type { TransactionCellParams } from '../cells/transaction-cell';
import type { TransactionsGridContext } from '../cells/transactions-grid-context';

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

/** A grid context with inert defaults. */
export function gridContext(
  overrides: Partial<TransactionsGridContext> = {},
): TransactionsGridContext {
  return {
    categories: signal<Category[]>([]),
    categoryUpdateErrorId: signal<number | null>(null),
    changeCategory: () => undefined,
    ...overrides,
  };
}

/** The slice of ag-Grid's renderer params the transaction cells actually read. */
export function cellParams(
  data: TransactionRow,
  context: TransactionsGridContext = gridContext(),
  value: unknown = undefined,
): TransactionCellParams {
  return { data, context, value } as TransactionCellParams;
}
