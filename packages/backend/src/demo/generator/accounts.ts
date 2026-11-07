import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import { hashText } from './random';

export type AccountKey = 'giro' | 'tagesgeld' | 'kreditkarte' | 'gemeinschaft' | 'baufi';

/**
 * Invented bank: a BLZ starting with 0 is never assigned in Germany, and an IBAN with check
 * digits `00` is never valid, so nothing here can collide with a real account.
 */
export const DEMO_BLZ = '09912345';
export const DEMO_BIC = 'TSTBDEX0XXX';

interface AccountDef {
  readonly id: number;
  readonly kontonummer: string;
  readonly holder: string;
  readonly bezeichnung: string;
  readonly kategorie: string;
  /** Balance before the first booking, in cents. */
  readonly openingCents: number;
}

export const ACCOUNTS: Record<AccountKey, AccountDef> = {
  giro: {
    id: 1,
    kontonummer: '0004711001',
    holder: 'Tobias Testmann',
    bezeichnung: 'Girokonto',
    kategorie: 'Privat',
    openingCents: 124_317,
  },
  tagesgeld: {
    id: 2,
    kontonummer: '0004711002',
    holder: 'Tobias Testmann',
    bezeichnung: 'Tagesgeld',
    kategorie: 'Sparen',
    openingCents: 820_000,
  },
  kreditkarte: {
    id: 3,
    kontonummer: '0004711003',
    holder: 'Tobias Testmann',
    bezeichnung: 'Kreditkarte',
    kategorie: 'Privat',
    openingCents: 0,
  },
  gemeinschaft: {
    id: 4,
    kontonummer: '0004711004',
    holder: 'Tobias und Sabine Testmann',
    bezeichnung: 'Gemeinschaftskonto',
    kategorie: 'Gemeinsam',
    openingCents: 0,
  },
  baufi: {
    id: 5,
    kontonummer: '0004711005',
    holder: 'Tobias und Sabine Testmann',
    bezeichnung: 'Baufinanzierung Altbau',
    kategorie: 'Gemeinsam',
    openingCents: 0,
  },
};

export const ACCOUNT_KEYS: readonly AccountKey[] = Object.keys(ACCOUNTS) as AccountKey[];

export function demoIban(kontonummer: string): string {
  return `DE00${DEMO_BLZ}${kontonummer}`;
}

/** A clearly fake, but stable IBAN for a counterparty, derived from its name. */
export function counterpartyIban(name: string): string {
  const digits: string = String(hashText(name)).padStart(10, '0').slice(-10);
  const blz: string = String(hashText(`blz:${name}`) % 10_000_000).padStart(8, '0');
  return `DE00${blz}${digits}`;
}

export interface FinalBalances {
  readonly cents: Record<AccountKey, number>;
  /** `YYYY-MM-DD`, the last day with data. */
  readonly date: string;
}

export function buildAccounts(balances: FinalBalances): AccountRow[] {
  return ACCOUNT_KEYS.map((key: AccountKey): AccountRow => {
    const def: AccountDef = ACCOUNTS[key];
    const saldo: number = balances.cents[key] / 100;
    return {
      id: def.id,
      kontonummer: def.kontonummer,
      unterkonto: null,
      blz: DEMO_BLZ,
      name: def.holder,
      bezeichnung: def.bezeichnung,
      waehrung: 'EUR',
      saldo,
      saldo_datum: `${balances.date} 07:30:00`,
      iban: demoIban(def.kontonummer),
      bic: DEMO_BIC,
      saldo_available: key === 'giro' ? saldo + 2500 : key === 'tagesgeld' ? saldo : null,
      kategorie: def.kategorie,
    };
  });
}
