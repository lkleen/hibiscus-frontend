import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import { ACCOUNTS, ACCOUNT_KEYS, counterpartyIban, demoIban, DEMO_BIC } from './accounts';
import type { AccountKey } from './accounts';
import { formatDay } from './calendar';
import type { Day } from './calendar';
import { categoryId } from './categories';
import type { CategoryKey } from './categories';
import { hashText, Random } from './random';

/** Hibiscus `umsatz.art` texts as banks deliver them. */
export type Art =
  | 'Kartenzahlung'
  | 'Lastschrift'
  | 'Überweisung'
  | 'Gutschrift'
  | 'Dauerauftrag'
  | 'Lohn/Gehalt'
  | 'Bargeldauszahlung'
  | 'Zinsen'
  | 'Entgelt'
  | 'Umbuchung';

/** The GV code a bank sends with each `art`. */
const GV_CODES: Record<Art, string> = {
  Kartenzahlung: '106',
  Lastschrift: '105',
  Überweisung: '116',
  Gutschrift: '166',
  Dauerauftrag: '117',
  'Lohn/Gehalt': '153',
  Bargeldauszahlung: '083',
  Zinsen: '805',
  Entgelt: '808',
  Umbuchung: '116',
};

/** Arts without a counterparty account (card terminals, ATMs, the bank's own bookings). */
const NO_COUNTERPARTY_ACCOUNT: ReadonlySet<Art> = new Set<Art>([
  'Kartenzahlung',
  'Bargeldauszahlung',
  'Zinsen',
  'Entgelt',
]);

/** Share of rows left uncategorised, like in a real Hibiscus database. */
const UNCATEGORISED_SHARE = 0.03;

export interface Booking {
  readonly account: AccountKey;
  /** Booking date (`datum`). */
  readonly day: Day;
  /** Value date; defaults to the booking date. */
  readonly valuta?: Day;
  /** Signed amount in cents: negative = debit. */
  readonly cents: number;
  readonly name: string | null;
  readonly zweck: string;
  readonly zweck2?: string;
  readonly art: Art;
  readonly category: CategoryKey | null;
  readonly kommentar?: string;
  /** The counterparty's IBAN when it is not derived from its name (own accounts). */
  readonly iban?: string;
  /** SEPA direct debit: adds a mandate and creditor id. */
  readonly mandate?: boolean;
  readonly purposecode?: string;
}

interface Entry {
  readonly seq: number;
  readonly booking: Booking;
}

export interface TransferParams {
  readonly from: AccountKey;
  readonly to: AccountKey;
  readonly day: Day;
  readonly cents: number;
  readonly zweck: string;
  readonly art?: Art;
  readonly category?: CategoryKey;
}

export interface LedgerResult {
  readonly transactions: TransactionRow[];
  readonly finalCents: Record<AccountKey, number>;
}

/**
 * Collects the bookings of the story. Bookings after `lastDay` are not recorded: the data ends
 * on the generation date, so anything the story would book later has simply not happened yet.
 */
export class Ledger {
  private readonly entries: Entry[] = [];
  private readonly balances: Record<AccountKey, number>;
  private readonly outflows: Record<AccountKey, number>;

  constructor(readonly lastDay: Day) {
    this.balances = this.perAccount((key: AccountKey): number => ACCOUNTS[key].openingCents);
    this.outflows = this.perAccount((): number => 0);
  }

  /** Records `booking` unless it lies after `lastDay`; returns whether it was recorded. */
  book(booking: Booking): boolean {
    if (!Number.isInteger(booking.cents) || booking.cents === 0) {
      throw new Error(`Booking amount must be a non-zero number of cents: ${booking.zweck}`);
    }
    if (booking.day > this.lastDay) return false;
    this.entries.push({ seq: this.entries.length, booking });
    this.balances[booking.account] += booking.cents;
    if (booking.cents < 0) this.outflows[booking.account] -= booking.cents;
    return true;
  }

  /** Books both sides of a transfer between two own accounts. */
  transfer(params: TransferParams): void {
    if (params.cents <= 0) throw new Error(`Transfer amount must be positive: ${params.zweck}`);
    const art: Art = params.art ?? 'Umbuchung';
    const category: CategoryKey = params.category ?? 'umbuchung';
    this.book({
      account: params.from,
      day: params.day,
      cents: -params.cents,
      name: ACCOUNTS[params.to].holder,
      iban: demoIban(ACCOUNTS[params.to].kontonummer),
      zweck: params.zweck,
      art,
      category,
    });
    this.book({
      account: params.to,
      day: params.day,
      cents: params.cents,
      name: ACCOUNTS[params.from].holder,
      iban: demoIban(ACCOUNTS[params.from].kontonummer),
      zweck: params.zweck,
      art: art === 'Dauerauftrag' ? 'Gutschrift' : art,
      category,
    });
  }

  /** The balance after every booking recorded so far, in cents. */
  balance(account: AccountKey): number {
    return this.balances[account];
  }

  /** The sum of all debits recorded so far, in cents (positive). */
  totalOutflow(account: AccountKey): number {
    return this.outflows[account];
  }

  /** Sorts by booking date (then recording order), assigns ids and running balances. */
  finalize(rng: Random): LedgerResult {
    const sorted: Entry[] = [...this.entries].sort(
      (a: Entry, b: Entry): number => a.booking.day - b.booking.day || a.seq - b.seq,
    );
    const running: Record<AccountKey, number> = this.perAccount(
      (key: AccountKey): number => ACCOUNTS[key].openingCents,
    );
    const transactions: TransactionRow[] = sorted.map((entry: Entry, index: number) => {
      const booking: Booking = entry.booking;
      running[booking.account] += booking.cents;
      const uncategorised: boolean =
        booking.category !== 'umbuchung' && rng.chance(UNCATEGORISED_SHARE);
      return toRow({
        id: index + 1,
        booking,
        saldoCents: running[booking.account],
        categoryKey: uncategorised ? null : booking.category,
      });
    });
    for (const key of ACCOUNT_KEYS) {
      if (running[key] !== this.balances[key]) throw new Error(`Saldo mismatch for ${key}`);
    }
    return { transactions, finalCents: { ...running } };
  }

  private perAccount(init: (key: AccountKey) => number): Record<AccountKey, number> {
    return {
      giro: init('giro'),
      tagesgeld: init('tagesgeld'),
      kreditkarte: init('kreditkarte'),
      gemeinschaft: init('gemeinschaft'),
      baufi: init('baufi'),
    };
  }
}

interface RowParams {
  readonly id: number;
  readonly booking: Booking;
  readonly saldoCents: number;
  readonly categoryKey: CategoryKey | null;
}

function toRow(params: RowParams): TransactionRow {
  const booking: Booking = params.booking;
  const hasAccount: boolean = booking.name !== null && !NO_COUNTERPARTY_ACCOUNT.has(booking.art);
  const iban: string | null = hasAccount
    ? (booking.iban ?? counterpartyIban(booking.name ?? ''))
    : null;
  const nameHash: string = String(hashText(booking.name ?? '')).padStart(10, '0');
  const isSepa: boolean = hasAccount && booking.art !== 'Umbuchung';
  return {
    id: params.id,
    konto_id: ACCOUNTS[booking.account].id,
    empfaenger_konto: iban,
    empfaenger_blz: iban === null ? null : booking.iban === undefined ? 'XXXXDEX0XXX' : DEMO_BIC,
    empfaenger_name: booking.name,
    empfaenger_name2: null,
    betrag: booking.cents / 100,
    zweck: booking.zweck,
    zweck2: booking.zweck2 ?? null,
    zweck3: null,
    datum: formatDay(booking.day),
    valuta: formatDay(booking.valuta ?? booking.day),
    saldo: params.saldoCents / 100,
    art: booking.art,
    gvcode: GV_CODES[booking.art],
    endtoendid: isSepa ? `E2E-${params.id}-${nameHash.slice(0, 6)}` : null,
    kommentar: booking.kommentar ?? null,
    purposecode: booking.purposecode ?? null,
    customerref: null,
    mandateid: booking.mandate ? `MREF-${nameHash}-TT` : null,
    creditorid: booking.mandate ? `DE00ZZZ0${nameHash}` : null,
    umsatztyp_id: params.categoryKey === null ? null : categoryId(params.categoryKey),
    flags: 0,
  };
}
