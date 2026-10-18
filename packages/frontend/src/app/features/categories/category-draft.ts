import type { CategoryEditableFields } from '@hibiscus-frontend/shared/contracts/categories';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';

/** Hibiscus `umsatztyp.umsatztyp` values: expense, income, and "any" (null). */
const UMSATZTYP_EXPENSE = 0;
const UMSATZTYP_INCOME = 1;

/**
 * A new category's starting values, prefilled from a transaction: its recipient name becomes the
 * name and the escaped pattern, and its sign picks expense or income. Everything else stays empty.
 * Hibiscus splits a non-regex pattern on unescaped commas, so each comma is escaped.
 */
export function categoryDraftFrom(transaction: TransactionRow): CategoryEditableFields {
  const name: string = (transaction.empfaenger_name ?? '').trim();
  return {
    name,
    nummer: null,
    pattern: name === '' ? null : name.replaceAll(',', '\\,'),
    isregex: 0,
    umsatztyp: umsatztypFor(transaction.betrag),
    parent_id: null,
    color: null,
    customcolor: null,
    kommentar: null,
    konto_id: null,
    konto_kategorie: null,
    flags: null,
  };
}

/** Negative amounts are expenses, positive ones income; zero matches any type. */
function umsatztypFor(betrag: number): number | null {
  if (betrag < 0) return UMSATZTYP_EXPENSE;
  if (betrag > 0) return UMSATZTYP_INCOME;
  return null;
}
