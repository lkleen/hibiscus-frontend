import { signal } from '@angular/core';
import type { Transaction } from '@hibiscus-frontend/shared/contracts/transactions';
import type { Category } from '../../../core/models/category.model';
import type { TransactionCellParams } from '../cells/transaction-cell';
import type { TransactionsGridContext } from '../cells/transactions-grid-context';

/** A fully populated transaction; override only what a test cares about. */
export function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 1,
    kontoId: 1,
    empfaengerKonto: null,
    empfaengerBlz: null,
    empfaengerName: null,
    empfaengerName2: null,
    betrag: -12.5,
    zweck: null,
    zweck2: null,
    zweck3: null,
    datum: '2026-09-01',
    valuta: '2026-09-01',
    saldo: null,
    umsatztypId: null,
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
  data: Transaction,
  context: TransactionsGridContext = gridContext(),
): TransactionCellParams {
  return { data, context } as TransactionCellParams;
}
