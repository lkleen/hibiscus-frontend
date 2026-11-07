import type { AccountKey } from './accounts';
import { formatDay, nextBusinessDay } from './calendar';
import type { Day } from './calendar';
import type { CategoryKey } from './categories';
import type { Art, Ledger } from './ledger';
import type { Random } from './random';

/** What every part of the story books through. */
export interface StoryContext {
  readonly rng: Random;
  readonly ledger: Ledger;
}

export interface Payment {
  /** The day the purchase or order happened; banks book it on the next working day. */
  readonly day: Day;
  readonly account: AccountKey;
  /** Signed cents: negative = money leaves the account. */
  readonly cents: number;
  readonly name: string;
  /** Defaults to the counterparty name, as card terminals send it. */
  readonly zweck?: string;
  readonly zweck2?: string;
  readonly category: CategoryKey;
  /** Defaults to a card payment. */
  readonly art?: Art;
  readonly kommentar?: string;
  readonly mandate?: boolean;
  /** A foreign-currency card payment, e.g. `45,00 DKK Kurs 7,4602`; adds the bank's fee. */
  readonly foreign?: string;
}

/** The credit card's foreign transaction fee. */
const FOREIGN_FEE_RATE = 0.0175;

/** Books a payment the way the bank would deliver it; returns whether it was booked. */
export function pay(ctx: StoryContext, payment: Payment): boolean {
  const art: Art = payment.art ?? 'Kartenzahlung';
  if (art !== 'Kartenzahlung') {
    return ctx.ledger.book({
      account: payment.account,
      day: nextBusinessDay(payment.day),
      valuta: nextBusinessDay(payment.day),
      cents: payment.cents,
      name: payment.name,
      zweck: payment.zweck ?? payment.name,
      zweck2: payment.zweck2,
      art,
      category: payment.category,
      kommentar: payment.kommentar,
      mandate: payment.mandate,
    });
  }
  if (payment.account === 'kreditkarte') return payByCreditCard(ctx, payment);
  return payByDebitCard(ctx, payment);
}

/** Girocard: booked one or two working days later, with the terminal timestamp in `zweck2`. */
function payByDebitCard(ctx: StoryContext, payment: Payment): boolean {
  const hour: string = String(ctx.rng.int(8, 20)).padStart(2, '0');
  const minute: string = String(ctx.rng.int(0, 59)).padStart(2, '0');
  const card: number = payment.account === 'gemeinschaft' ? ctx.rng.int(1, 2) : 1;
  return ctx.ledger.book({
    account: payment.account,
    day: nextBusinessDay(payment.day + ctx.rng.int(0, 1)),
    valuta: payment.day,
    cents: payment.cents,
    name: payment.name,
    zweck: payment.zweck ?? `${payment.name}//MUSTERSTADT/DE`,
    zweck2: payment.zweck2 ?? `${formatDay(payment.day)}T${hour}:${minute} Debitk.${card}`,
    art: 'Kartenzahlung',
    category: payment.category,
    kommentar: payment.kommentar,
  });
}

function payByCreditCard(ctx: StoryContext, payment: Payment): boolean {
  const day: Day = nextBusinessDay(payment.day + ctx.rng.int(1, 2));
  const booked: boolean = ctx.ledger.book({
    account: 'kreditkarte',
    day,
    valuta: payment.day,
    cents: payment.cents,
    name: payment.name,
    zweck: payment.zweck ?? payment.name,
    zweck2: payment.zweck2 ?? payment.foreign,
    art: 'Kartenzahlung',
    category: payment.category,
    kommentar: payment.kommentar,
  });
  if (booked && payment.foreign !== undefined) {
    const fee: number = Math.round(payment.cents * FOREIGN_FEE_RATE);
    if (fee !== 0) {
      ctx.ledger.book({
        account: 'kreditkarte',
        day,
        valuta: payment.day,
        cents: fee,
        name: null,
        zweck: `Auslandseinsatzentgelt 1,75 % ${payment.name}`,
        art: 'Entgelt',
        category: 'gebuehren',
      });
    }
  }
  return booked;
}

/** Euros to cents, for hand-written amounts in the story. */
export function euros(amount: number): number {
  return Math.round(amount * 100);
}
