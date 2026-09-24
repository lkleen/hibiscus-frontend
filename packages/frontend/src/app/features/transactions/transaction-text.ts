import type { Transaction } from '@hibiscus-frontend/shared/contracts/transactions';

function joinParts(parts: readonly (string | null)[]): string | null {
  const joined: string = parts
    .filter((part): part is string => part !== null && part.trim() !== '')
    .join(' ');
  return joined === '' ? null : joined;
}

/** Hibiscus splits the counterparty name over two columns; the UI shows them as one line. */
export function counterpartyOf(transaction: Transaction): string | null {
  return joinParts([transaction.empfaengerName, transaction.empfaengerName2]);
}

/** The purpose ("Verwendungszweck") is stored as up to three lines. */
export function purposeOf(transaction: Transaction): string | null {
  return joinParts([transaction.zweck, transaction.zweck2, transaction.zweck3]);
}
