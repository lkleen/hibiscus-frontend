import {
  dayOf,
  daysInMonth,
  lastBusinessDay,
  monthLabel,
  monthOf,
  nextBusinessDay,
  parseDay,
  yearOf,
} from './calendar';
import type { Day } from './calendar';
import { ODDITIES, ONE_OFFS, OWN_TRANSFERS, TRIPS, tripSpan } from './events';
import type { Currency, Oddity, OneOff, OwnTransfer, Trip, TripMishap, TripSpan } from './events';
import { bookHabits } from './habits';
import { euros, pay } from './payments';
import type { StoryContext } from './payments';
import { bookRecurring } from './recurring';
import {
  BIGGER_FLAT,
  CAR_BOUGHT,
  CORONA_LOCKDOWN,
  hasJointAccount,
  HOUSE_HANDOVER,
  JOB_CHANGE,
  JOINT_ACCOUNT_OPENED,
  netSalaryCents,
  NEW_EMPLOYER,
  OLD_EMPLOYER,
  PARENTAL_LEAVE_END,
  PARENTAL_LEAVE_START,
  STORY_START,
} from './timeline';

type StoryEvent = (ctx: StoryContext) => void;

/** The mortgage: amount, monthly rate and interest. */
const LOAN_CENTS = 320_000_00;
const LOAN_RATE_CENTS = 1_240_00;
const LOAN_INTEREST = 0.0115;
const LOAN_DISBURSED: Day = dayOf(2021, 3, 31);
/** The part of the loan paid out to the joint account for the renovation. */
const RENOVATION_LOAN_CENTS = 45_000_00;

/** Day of the month Tobias moves what is left on the Girokonto to savings. */
const SAVINGS_DAY = 20;
/** What stays on the Girokonto after the savings transfer, in cents. */
const GIRO_CUSHION = 800_00;

/** Tagesgeld interest per year (the zero-interest years were real). */
const SAVINGS_INTEREST: Record<number, number> = {
  2014: 0.006,
  2015: 0.003,
  2016: 0.001,
  2017: 0.0005,
  2018: 0.0005,
  2019: 0.0001,
  2020: 0.0001,
  2021: 0.0001,
  2022: 0.003,
  2023: 0.025,
  2024: 0.03,
  2025: 0.02,
  2026: 0.0175,
};

/** Tells Tobias Testmann's story from 2014 up to the ledger's last day. */
export function tellStory(ctx: StoryContext): void {
  const events: Map<Day, StoryEvent[]> = scheduleEvents(ctx);
  const traveling: Set<Day> = travelDays();
  const lastDay: Day = ctx.ledger.lastDay;
  let jointOutflowAtMonthStart = 0;
  for (let year: number = yearOf(STORY_START); year <= yearOf(lastDay); year++) {
    const lastMonth: number = year === yearOf(lastDay) ? monthOf(lastDay) : 12;
    for (let month = 1; month <= lastMonth; month++) {
      settleCreditCard(ctx, { year, month });
      const jointOutflow: number = ctx.ledger.totalOutflow('gemeinschaft');
      fundJointAccount(ctx, {
        year,
        month,
        spentLastMonth: jointOutflow - jointOutflowAtMonthStart,
      });
      jointOutflowAtMonthStart = jointOutflow;
      payMortgage(ctx, { year, month });
      bookRecurring(ctx, { year, month });
      bookMonthlyChances(ctx, { year, month });
      for (let date = 1; date <= daysInMonth(year, month); date++) {
        const day: Day = dayOf(year, month, date);
        if (day > lastDay) break;
        bookHabits(ctx, { day, traveling: traveling.has(day) });
        for (const event of events.get(day) ?? []) event(ctx);
        topUpJointAccount(ctx, day);
        if (date === SAVINGS_DAY) balanceGiro(ctx, { today: day, save: true });
      }
      const monthEnd: Day = lastBusinessDay(year, month);
      if (monthEnd <= lastDay) {
        topUpJointAccount(ctx, monthEnd);
        balanceGiro(ctx, { today: monthEnd, save: false });
      }
      paySalary(ctx, { year, month });
      if (month === 12) closeYear(ctx, year);
    }
  }
}

interface MonthParams {
  readonly year: number;
  readonly month: number;
}

function scheduleEvents(ctx: StoryContext): Map<Day, StoryEvent[]> {
  const events: Map<Day, StoryEvent[]> = new Map<Day, StoryEvent[]>();
  const add = (day: Day, event: StoryEvent): void => {
    const list: StoryEvent[] = events.get(day) ?? [];
    list.push(event);
    events.set(day, list);
  };
  for (const oneOff of ONE_OFFS)
    add(parseDay(oneOff.date), (c: StoryContext) => bookOneOff(c, oneOff));
  for (const transfer of OWN_TRANSFERS) {
    add(parseDay(transfer.date), (c: StoryContext) => bookOwnTransfer(c, transfer));
  }
  for (const oddity of ODDITIES) {
    const from: Day = parseDay(oddity.from);
    const day: Day = from + ctx.rng.int(0, parseDay(oddity.until) - from);
    add(day, (c: StoryContext) => bookOddity(c, { oddity, day }));
  }
  for (const trip of TRIPS) {
    const start: Day = tripSpan(trip).start;
    const booked: Day = start - ctx.rng.int(40, 100);
    add(booked, (c: StoryContext) => bookTripTravel(c, { trip, booked }));
    for (let night = 0; night <= trip.nights; night++) {
      add(start + night, (c: StoryContext) => bookTripDay(c, { trip, day: start + night }));
    }
    for (const mishap of trip.mishaps ?? []) {
      add(start + mishap.offset, (c: StoryContext) => bookMishap(c, { trip, mishap }));
    }
  }
  add(dayOf(2021, 2, 8), buyHouse);
  add(LOAN_DISBURSED, disburseLoan);
  return events;
}

function travelDays(): Set<Day> {
  const days: Set<Day> = new Set<Day>();
  for (const trip of TRIPS) {
    const span: TripSpan = tripSpan(trip);
    for (let day: Day = span.start; day <= span.end; day++) days.add(day);
  }
  return days;
}

function bookOneOff(ctx: StoryContext, oneOff: OneOff): void {
  pay(ctx, {
    day: parseDay(oneOff.date),
    account: oneOff.account,
    cents: euros(oneOff.euros),
    name: oneOff.name,
    zweck: oneOff.zweck,
    category: oneOff.category,
    art: oneOff.art,
    kommentar: oneOff.kommentar,
  });
}

function bookOwnTransfer(ctx: StoryContext, transfer: OwnTransfer): void {
  ctx.ledger.transfer({
    from: transfer.from,
    to: transfer.to,
    day: nextBusinessDay(parseDay(transfer.date)),
    cents: euros(transfer.euros),
    zweck: transfer.zweck,
  });
}

function bookOddity(ctx: StoryContext, params: { oddity: Oddity; day: Day }): void {
  const oddity: Oddity = params.oddity;
  pay(ctx, {
    day: params.day,
    account: 'kreditkarte',
    cents: euros(oddity.euros),
    name: oddity.name,
    zweck: `${oddity.name} ${oddity.zweck}`,
    category: oddity.category ?? 'kurioses',
    kommentar: oddity.kommentar,
  });
  if (oddity.returnedAfter !== undefined) {
    pay(ctx, {
      day: params.day + oddity.returnedAfter,
      account: 'kreditkarte',
      cents: -euros(oddity.euros),
      name: oddity.name,
      zweck: `${oddity.name} GUTSCHRIFT RETOURE ${oddity.zweck}`,
      category: 'erstattungen',
    });
  }
}

function foreignText(currency: Currency | null, cents: number): string | undefined {
  if (currency === null) return undefined;
  const amount: string = ((Math.abs(cents) / 100) * currency.rate).toFixed(2).replace('.', ',');
  return `${amount} ${currency.code} Kurs ${String(currency.rate).replace('.', ',')}`;
}

/** The journey there: booked weeks ahead, or fuel and tolls on the day for a road trip. */
function bookTripTravel(ctx: StoryContext, params: { trip: Trip; booked: Day }): void {
  const trip: Trip = params.trip;
  const start: Day = tripSpan(trip).start;
  const byCar: boolean = /TANKSTELLE|PEAGE|PEDAGGIO/.test(trip.carrier);
  const cents: number = euros(trip.travel);
  pay(ctx, {
    day: byCar ? start : params.booked,
    account: 'kreditkarte',
    cents,
    name: trip.carrier,
    zweck: `${trip.carrier} ${trip.destination.toUpperCase()}`,
    category: trip.carrier.startsWith('TANKSTELLE')
      ? 'tanken'
      : byCar
        ? 'urlaubVorOrt'
        : 'transport',
    foreign: foreignText(trip.currency, cents),
  });
}

function bookTripDay(ctx: StoryContext, params: { trip: Trip; day: Day }): void {
  const trip: Trip = params.trip;
  const end: Day = tripSpan(trip).end;
  const party: number = params.day >= JOINT_ACCOUNT_OPENED ? 2 : 1;
  if (params.day === end) {
    const cents: number = euros(trip.lodgingCost);
    pay(ctx, {
      day: params.day,
      account: 'kreditkarte',
      cents,
      name: trip.lodging,
      zweck: `${trip.lodging} ${trip.nights} NAECHTE`,
      category: 'unterkunft',
      foreign: foreignText(trip.currency, cents),
    });
    return;
  }
  const count: number = ctx.rng.int(1, 3);
  for (let i = 0; i < count; i++) {
    const cents: number = -ctx.rng.cents(6 * party, 70 * party);
    pay(ctx, {
      day: params.day,
      account: 'kreditkarte',
      cents,
      name: ctx.rng.pick(trip.spots),
      category: 'urlaubVorOrt',
      foreign: foreignText(trip.currency, cents),
    });
  }
}

function bookMishap(ctx: StoryContext, params: { trip: Trip; mishap: TripMishap }): void {
  const start: Day = tripSpan(params.trip).start;
  const cents: number = euros(params.mishap.euros);
  pay(ctx, {
    day: start + params.mishap.offset,
    account: 'kreditkarte',
    cents,
    name: params.mishap.name,
    zweck: params.mishap.zweck,
    category: params.mishap.category,
    kommentar: params.mishap.kommentar,
    foreign: foreignText(params.trip.currency, cents),
  });
}

/** Everything left in savings goes into the house, plus Sabine's share. */
function buyHouse(ctx: StoryContext): void {
  const day: Day = nextBusinessDay(dayOf(2021, 2, 8));
  ctx.ledger.book({
    account: 'gemeinschaft',
    day,
    cents: 25_000_00,
    name: 'Sabine Testmann',
    zweck: 'Eigenkapital-Anteil Sabine (Bausparvertrag + Oma Gertrud)',
    art: 'Gutschrift',
    category: 'umbuchung',
  });
  ctx.ledger.transfer({
    from: 'tagesgeld',
    to: 'gemeinschaft',
    day,
    cents: 12_000_00,
    zweck: 'Eigenkapital Nebenkosten Hauskauf',
  });
  const equity: number =
    Math.floor((ctx.ledger.balance('tagesgeld') - 8_000_00) / 100_000) * 100_000;
  if (equity <= 0) throw new Error('The savings cannot cover the house equity');
  ctx.ledger.book({
    account: 'tagesgeld',
    day: day + 14,
    cents: -equity,
    name: 'Notaranderkonto Dr. Siegel & Stempel',
    zweck: 'Eigenkapital Kaufpreis Lindenweg 3, UR-Nr. 211/2021',
    art: 'Überweisung',
    category: 'umbuchung',
  });
}

function disburseLoan(ctx: StoryContext): void {
  ctx.ledger.book({
    account: 'baufi',
    day: LOAN_DISBURSED,
    cents: -LOAN_CENTS,
    name: 'Notaranderkonto Dr. Siegel & Stempel',
    zweck: 'Darlehensauszahlung Annuitätendarlehen 4711-0815, 1,15 % fest bis 2036',
    art: 'Überweisung',
    category: 'umbuchung',
  });
  ctx.ledger.transfer({
    from: 'baufi',
    to: 'gemeinschaft',
    day: nextBusinessDay(LOAN_DISBURSED + 1),
    cents: RENOVATION_LOAN_CENTS,
    zweck: 'Teilauszahlung Modernisierung Darlehen 4711-0815',
  });
}

/** From the joint account: the instalment, then the interest the bank charges for the month. */
function payMortgage(ctx: StoryContext, params: MonthParams): void {
  const day: Day = lastBusinessDay(params.year, params.month);
  if (day <= LOAN_DISBURSED || day > ctx.ledger.lastDay) return;
  const owed: number = -ctx.ledger.balance('baufi');
  const interest: number = Math.round((owed * LOAN_INTEREST) / 12);
  ctx.ledger.book({
    account: 'baufi',
    day,
    cents: -interest,
    name: null,
    zweck: `Sollzinsen ${monthLabel(params.year, params.month)} Darlehen 4711-0815`,
    art: 'Zinsen',
    category: 'kreditzinsen',
  });
  ctx.ledger.transfer({
    from: 'gemeinschaft',
    to: 'baufi',
    day,
    cents: Math.min(LOAN_RATE_CENTS, owed + interest),
    zweck: `Rate ${monthLabel(params.year, params.month)} Darlehen 4711-0815`,
    art: 'Dauerauftrag',
  });
}

/** The credit card bill of last month, collected from the Girokonto. */
function settleCreditCard(ctx: StoryContext, params: MonthParams): void {
  const owed: number = -ctx.ledger.balance('kreditkarte');
  if (owed <= 0) return;
  const previous: Day = dayOf(params.year, params.month, 1) - 1;
  const day: Day = nextBusinessDay(dayOf(params.year, params.month, 3));
  const shortfall: number = owed + GIRO_CUSHION / 2 - ctx.ledger.balance('giro');
  if (owed > 1_500_00 && shortfall > 0) {
    ctx.ledger.transfer({
      from: 'tagesgeld',
      to: 'giro',
      day,
      cents: Math.ceil(shortfall / 100_00) * 100_00,
      zweck: 'Umbuchung für Kreditkartenabrechnung',
    });
  }
  ctx.ledger.transfer({
    from: 'giro',
    to: 'kreditkarte',
    day,
    cents: owed,
    zweck: `Kreditkartenabrechnung ${monthLabel(yearOf(previous), monthOf(previous))} Karte 4711 XXXX XXXX 0815`,
    art: 'Lastschrift',
  });
}

/** Both partners top the joint account up to last month's spending plus a cushion. */
function fundJointAccount(
  ctx: StoryContext,
  params: MonthParams & { readonly spentLastMonth: number },
): void {
  const day: Day = nextBusinessDay(
    Math.max(dayOf(params.year, params.month, 1), JOINT_ACCOUNT_OPENED),
  );
  if (!hasJointAccount(day) || monthOf(day) !== params.month) return;
  const spent: number = Math.max(params.spentLastMonth, 1_500_00);
  const needed: number = spent + 1_000_00 - ctx.ledger.balance('gemeinschaft');
  const share: number = Math.min(
    Math.max(Math.ceil(needed / 2 / 100_00) * 100_00, 300_00),
    5_000_00,
  );
  const zweck = `Haushaltskasse ${monthLabel(params.year, params.month)}`;
  ctx.ledger.transfer({
    from: 'giro',
    to: 'gemeinschaft',
    day,
    cents: share,
    zweck,
    art: 'Dauerauftrag',
  });
  ctx.ledger.book({
    account: 'gemeinschaft',
    day,
    cents: share,
    name: 'Sabine Testmann',
    zweck,
    art: 'Gutschrift',
    category: 'umbuchung',
  });
}

/** When the joint account ran dry, both partners put in what is missing plus a cushion. */
function topUpJointAccount(ctx: StoryContext, today: Day): void {
  const balance: number = ctx.ledger.balance('gemeinschaft');
  if (!hasJointAccount(today) || balance >= 0) return;
  const day: Day = nextBusinessDay(today);
  const share: number = Math.ceil((500_00 - balance) / 2 / 100_00) * 100_00;
  const zweck = `Nachschuss Haushaltskasse ${monthLabel(yearOf(today), monthOf(today))}`;
  ctx.ledger.transfer({ from: 'giro', to: 'gemeinschaft', day, cents: share, zweck });
  ctx.ledger.book({
    account: 'gemeinschaft',
    day,
    cents: share,
    name: 'Sabine Testmann',
    zweck,
    art: 'Gutschrift',
    category: 'umbuchung',
  });
}

/** Moves the surplus to savings mid-month, or tops the Girokonto up when it ran dry. */
function balanceGiro(ctx: StoryContext, params: { today: Day; save: boolean }): void {
  const day: Day = nextBusinessDay(params.today);
  const balance: number = ctx.ledger.balance('giro');
  const label: string = monthLabel(yearOf(params.today), monthOf(params.today));
  if (params.save && balance > GIRO_CUSHION + 400_00) {
    ctx.ledger.transfer({
      from: 'giro',
      to: 'tagesgeld',
      day,
      cents: Math.floor((balance - GIRO_CUSHION) / 100_00) * 100_00,
      zweck: `Sparen ${label}`,
    });
  } else if (balance < 0) {
    ctx.ledger.transfer({
      from: 'tagesgeld',
      to: 'giro',
      day,
      cents: Math.ceil((GIRO_CUSHION / 2 - balance) / 100_00) * 100_00,
      zweck: `Umbuchung Dispo vermeiden ${label}`,
    });
  }
}

function paySalary(ctx: StoryContext, params: MonthParams): void {
  const day: Day = lastBusinessDay(params.year, params.month);
  if (day >= PARENTAL_LEAVE_START && day < PARENTAL_LEAVE_END) return;
  const employer: string = day >= JOB_CHANGE ? NEW_EMPLOYER : OLD_EMPLOYER;
  const shortTime: boolean = day >= CORONA_LOCKDOWN && day < dayOf(2020, 7, 1);
  const net: number = netSalaryCents(day);
  const label: string = monthLabel(params.year, params.month);
  ctx.ledger.book({
    account: 'giro',
    day,
    cents: shortTime ? Math.round(net * 0.86) : net,
    name: employer,
    zweck: shortTime ? `LOHN/GEHALT ${label} inkl. Kurzarbeitergeld` : `LOHN/GEHALT ${label}`,
    art: 'Lohn/Gehalt',
    category: 'gehalt',
    purposecode: 'SALA',
  });
  if (params.month === 11) payChristmasBonus(ctx, { day, employer, net });
}

function payChristmasBonus(
  ctx: StoryContext,
  params: { readonly day: Day; readonly employer: string; readonly net: number },
): void {
  const year: number = yearOf(params.day);
  const share: number = year === 2020 ? 0.25 : year === 2022 ? 0.375 : 0.5;
  const note: string =
    year === 2020 ? ' (gekürzt, Kurzarbeit)' : year === 2022 ? ' (anteilig)' : '';
  ctx.ledger.book({
    account: 'giro',
    day: params.day,
    cents: Math.round(params.net * share),
    name: params.employer,
    zweck: `Weihnachtsgeld ${year}${note}`,
    art: 'Lohn/Gehalt',
    category: 'gehalt',
    purposecode: 'BONU',
  });
}

/** Car trouble, tax refunds, the yearly utility bill of the flats and December donations. */
function bookMonthlyChances(ctx: StoryContext, params: MonthParams): void {
  const mid: Day = dayOf(params.year, params.month, ctx.rng.int(1, 28));
  if (mid >= CAR_BOUGHT) bookCarTrouble(ctx, { ...params, day: mid });
  if (params.month === 7 && params.year > 2014) {
    pay(ctx, {
      day: mid,
      account: 'giro',
      cents: ctx.rng.cents(180, 1400) * (params.year >= 2022 ? 2 : 1),
      name: 'Finanzamt Musterstadt',
      zweck: `Einkommensteuer ${params.year - 1} Erstattung StNr. 47/110/0815`,
      art: 'Gutschrift',
      category: 'erstattungen',
    });
  }
  if (params.month === 6 && mid > dayOf(2015, 1, 1) && mid < HOUSE_HANDOVER) {
    const cents: number = ctx.rng.int(-260_00, 180_00);
    pay(ctx, {
      day: mid,
      account: mid >= JOINT_ACCOUNT_OPENED ? 'gemeinschaft' : 'giro',
      cents: cents === 0 ? 1 : cents,
      name: mid >= BIGGER_FLAT ? 'Wohnbau Hochglanz GmbH' : 'Hausverwaltung Bröselmann',
      zweck: `Betriebskostenabrechnung ${params.year - 1} ${cents > 0 ? 'Guthaben' : 'Nachzahlung'}`,
      art: cents > 0 ? 'Gutschrift' : 'Überweisung',
      category: cents > 0 ? 'erstattungen' : 'miete',
    });
  }
  if (params.month === 12) {
    pay(ctx, {
      day: dayOf(params.year, 12, ctx.rng.int(10, 22)),
      account: 'giro',
      cents: -ctx.rng.pick([30, 50, 50, 75, 100, 150, 200]) * 100,
      name: 'Helfende Hände e.V.',
      zweck: `Weihnachtsspende ${params.year}`,
      art: 'Überweisung',
      category: 'spenden',
    });
  }
}

const TICKET_REASONS: readonly string[] = [
  'Parken im eingeschränkten Halteverbot',
  'Parken ohne Parkschein',
  'Parkzeit überschritten (12 Minuten)',
  'Parken auf dem Gehweg',
  'Parken auf dem Mitarbeiterparkplatz des Ordnungsamts',
  'Geschwindigkeitsüberschreitung 8 km/h innerorts',
];

const WORKSHOP_JOBS: readonly string[] = [
  'Bremsbeläge vorne',
  'Batterie erneuert',
  'Klimaanlage befüllt',
  'Reifenwechsel + Einlagerung',
  'Auspuff-Halterung (klapperte "wie ein Schlagzeug")',
  'Scheibenwischer + Glühbirne Abblendlicht',
  'Marderschaden Kühlschlauch',
];

function bookCarTrouble(ctx: StoryContext, params: MonthParams & { readonly day: Day }): void {
  const account: 'giro' | 'gemeinschaft' = hasJointAccount(params.day) ? 'gemeinschaft' : 'giro';
  if (ctx.rng.chance(0.14)) {
    pay(ctx, {
      day: params.day,
      account: 'giro',
      cents: -ctx.rng.pick([10, 15, 20, 25, 30, 35, 55]) * 100,
      name: 'Stadtkasse Musterstadt',
      zweck: `Verwarnungsgeld Az. ${params.year}-${ctx.rng.int(1000, 9999)} ${ctx.rng.pick(TICKET_REASONS)}`,
      art: 'Überweisung',
      category: 'parken',
    });
  }
  if (params.month === 9) {
    pay(ctx, {
      day: params.day,
      account,
      cents: -ctx.rng.cents(240, 560),
      name: 'Kfz-Meisterbetrieb Schraubert',
      zweck: `Rg. ${params.year}-${ctx.rng.int(100, 999)} Inspektion + Ölwechsel MU-TT 1337`,
      art: 'Überweisung',
      category: 'werkstatt',
    });
  }
  if (params.month === 5 && params.year % 2 === 0) {
    pay(ctx, {
      day: params.day,
      account: 'giro',
      cents: -euros(params.year >= 2024 ? 154.9 : 139.5),
      name: 'Prüfstelle Plakettenfroh',
      zweck: `Hauptuntersuchung MU-TT 1337 (${params.year > 2020 ? 'Nachprüfung inkl.' : 'ohne Mängel!'})`,
      category: 'werkstatt',
    });
  }
  if (ctx.rng.chance(0.07)) {
    pay(ctx, {
      day: params.day,
      account,
      cents: -ctx.rng.cents(90, 1200),
      name: 'Kfz-Meisterbetrieb Schraubert',
      zweck: `Rg. ${params.year}-${ctx.rng.int(100, 999)} ${ctx.rng.pick(WORKSHOP_JOBS)}`,
      art: 'Überweisung',
      category: 'werkstatt',
    });
  }
}

/** Interest on savings, and from 2022 a special repayment on the mortgage. */
function closeYear(ctx: StoryContext, year: number): void {
  const day: Day = lastBusinessDay(year, 12);
  const rate: number | undefined = SAVINGS_INTEREST[Math.min(year, 2026)];
  if (rate === undefined) throw new Error(`No savings interest for ${year}`);
  const interest: number = Math.round(ctx.ledger.balance('tagesgeld') * rate);
  if (interest > 0) {
    ctx.ledger.book({
      account: 'tagesgeld',
      day,
      cents: interest,
      name: 'Testbank Musterstadt',
      zweck: `Habenzinsen 01.01.${year}-31.12.${year} (${(rate * 100).toFixed(2).replace('.', ',')} % p.a.)`,
      art: 'Zinsen',
      category: 'zinsen',
    });
  }
  const spare: number =
    Math.floor((ctx.ledger.balance('tagesgeld') - 15_000_00) / 100_000) * 100_000;
  if (year >= 2022 && spare >= 2_000_00 && day > LOAN_DISBURSED) {
    ctx.ledger.transfer({
      from: 'tagesgeld',
      to: 'baufi',
      day,
      cents: Math.min(spare, 16_000_00),
      zweck: `Sondertilgung ${year} Darlehen 4711-0815`,
    });
  }
}
