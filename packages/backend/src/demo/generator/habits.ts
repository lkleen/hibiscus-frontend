import type { AccountKey } from './accounts';
import { dayOf, isWeekend } from './calendar';
import type { Day } from './calendar';
import type { CategoryKey } from './categories';
import { pay } from './payments';
import type { StoryContext } from './payments';
import {
  BIGGER_FLAT,
  CAR_BOUGHT,
  CORONA_LOCKDOWN,
  D_TICKET,
  EMIL_BORN,
  hasJointAccount,
  HOUSE_HANDOVER,
  JOB_CHANGE,
  JOINT_ACCOUNT_OPENED,
  MET_SABINE,
  NEW_EMPLOYER,
  OFFICE_REOPENED,
  OLD_EMPLOYER,
  PARENTAL_LEAVE_END,
  PARENTAL_LEAVE_START,
  PREGNANCY_KNOWN,
  priceIndex,
  RENOVATION_END,
  SABINE_MOVES_IN,
} from './timeline';

/**
 * Scales every daily habit; tuned so the twelve years add up to roughly 25,000 transactions.
 */
const ACTIVITY = 1.45;

/** At home vs. away: the habits mostly pause while travelling. */
const TRAVEL_DAMPING = 0.1;

/** Something Tobias (or the household) does now and then, paid on the spot. */
interface Habit {
  readonly category: CategoryKey;
  /** Expected occurrences per day. */
  readonly rate: (day: Day) => number;
  readonly account: (ctx: StoryContext, day: Day) => AccountKey;
  readonly merchants: readonly string[];
  /** Euros at 2014 prices. */
  readonly min: number;
  readonly max: number;
  /** Scales with the household: one person, a couple, a family. */
  readonly perPerson?: boolean;
  /** Chance of yet another visit the same day, after each visit. */
  readonly repeat?: (day: Day) => number;
}

function giro(): AccountKey {
  return 'giro';
}

function creditCard(): AccountKey {
  return 'kreditkarte';
}

/** Mostly the joint account once there is one. */
function shared(share: number): (ctx: StoryContext, day: Day) => AccountKey {
  return (ctx: StoryContext, day: Day): AccountKey =>
    hasJointAccount(day) && ctx.rng.chance(share) ? 'gemeinschaft' : 'giro';
}

function mixed(creditShare: number): (ctx: StoryContext) => AccountKey {
  return (ctx: StoryContext): AccountKey => (ctx.rng.chance(creditShare) ? 'kreditkarte' : 'giro');
}

/** How likely Tobias is in the office today (Corona, home office after the job change). */
function officeDay(day: Day): number {
  if (isWeekend(day)) return 0;
  if (day >= PARENTAL_LEAVE_START && day < PARENTAL_LEAVE_END) return 0;
  if (day >= CORONA_LOCKDOWN && day < OFFICE_REOPENED) return 0.05;
  return day >= JOB_CHANGE ? 0.6 : 0.95;
}

function householdSize(day: Day): number {
  if (day >= EMIL_BORN) return 1.7;
  if (day >= JOINT_ACCOUNT_OPENED) return 1.4;
  return day >= SABINE_MOVES_IN ? 1.2 : 1;
}

function babyMonths(day: Day): boolean {
  return day >= EMIL_BORN && day < EMIL_BORN + 365;
}

const HABITS: readonly Habit[] = [
  {
    category: 'supermarkt',
    rate: (day: Day): number =>
      0.6 + (day >= SABINE_MOVES_IN ? 0.15 : 0) + (day >= EMIL_BORN ? 0.1 : 0),
    account: shared(0.75),
    merchants: [
      'FRISCHEKORB MARKT',
      'SPARMARKT KUEHN',
      'PREISWUT DISCOUNT',
      'BIO-OASE GRUENZEUG',
      'GETRAENKE KISTENSCHLEPPER',
    ],
    min: 3.5,
    max: 24,
    perPerson: true,
  },
  {
    category: 'baecker',
    rate: (day: Day): number => (day >= EMIL_BORN ? 0.6 : 0.8),
    account: shared(0.4),
    merchants: ['BAECKEREI HEFEZOPF', 'CAFE MILCHSCHAUM', 'KAFFEEBAR BOHNE UND BROESEL'],
    min: 1.2,
    max: 9,
  },
  {
    category: 'kantine',
    rate: (day: Day): number => officeDay(day) * 0.6,
    account: giro,
    merchants: [],
    min: 3.2,
    max: 8.9,
  },
  {
    category: 'baecker',
    rate: (day: Day): number => officeDay(day) * 0.5,
    account: giro,
    merchants: ['KAFFEEBAR BOHNE UND BROESEL', 'ESPRESSOBAR AM BUERO', 'GETRAENKEAUTOMAT FOYER'],
    min: 1.5,
    max: 4.5,
  },
  {
    category: 'restaurant',
    rate: (day: Day): number => {
      if (day >= dayOf(2025, 1, 1)) return 0.06;
      if (day >= EMIL_BORN) return 0.03;
      if (day >= CORONA_LOCKDOWN && day < OFFICE_REOPENED) return 0.03;
      return day >= MET_SABINE ? 0.11 : 0.08;
    },
    account: mixed(0.6),
    merchants: [
      'TRATTORIA DA TESTA',
      'ZUM GOLDENEN SCHNITZEL',
      'SUSHI SAKURA MITTE',
      'BURGEREI 3000',
      'LE PETIT BISTRO',
      'PIZZERIA BELLA CIAO',
      'TAVERNA OLYMPOS',
      'GASTHAUS ZUR FEUCHTEN ECKE',
      'RAMEN-BAR NUDELSUPPE',
    ],
    min: 14,
    max: 90,
  },
  {
    category: 'lieferdienst',
    rate: (day: Day): number => {
      if (day >= EMIL_BORN) return 0.11;
      if (day >= CORONA_LOCKDOWN && day < OFFICE_REOPENED) return 0.15;
      return 0.07;
    },
    account: creditCard,
    merchants: ['LIEFERFLITZER', 'PIZZA-TAXI TURBO', 'CURRY-KURIER'],
    min: 14,
    max: 48,
  },
  {
    category: 'online',
    rate: (): number => 0.1,
    account: creditCard,
    merchants: [
      'KLICKKAUF.DE',
      'MARKTPLATZ24',
      'RAMSCHWELT ONLINE',
      'BUCHHANDEL SEITENWIND',
      'TECHNIKTRUHE VERSAND',
    ],
    min: 5,
    max: 90,
  },
  {
    category: 'drogerie',
    rate: (day: Day): number => (day >= EMIL_BORN ? 0.22 : 0.1),
    account: shared(0.8),
    merchants: ['DROGERIE SEIFENBLASE', 'DROGERIEMARKT DUFTWOLKE'],
    min: 1.5,
    max: 30,
    perPerson: true,
  },
  {
    category: 'kleidung',
    rate: (): number => 0.02,
    account: mixed(0.5),
    merchants: ['MODEHAUS FADENSCHEIN', 'SCHUHHAUS PLATTFUSS', 'OUTDOOR WETTERFEST'],
    min: 20,
    max: 160,
  },
  {
    category: 'oepnv',
    rate: (day: Day): number => {
      if (day >= D_TICKET) return 0.01;
      return day >= CAR_BOUGHT ? 0.05 : 0.3;
    },
    account: giro,
    merchants: ['VERKEHRSVERBUND MUSTERLAND'],
    min: 2.8,
    max: 9.5,
  },
  {
    category: 'tanken',
    rate: (day: Day): number => (day >= CAR_BOUGHT ? 0.07 : 0),
    account: mixed(0.5),
    merchants: ['TANKSTELLE ZAPFHAHN', 'SUPER-SPRIT AN DER B42', 'AUTOHOF DIESELDUFT'],
    min: 35,
    max: 85,
  },
  {
    category: 'parken',
    rate: (day: Day): number => (day >= CAR_BOUGHT ? 0.05 : 0),
    account: giro,
    merchants: ['PARKHAUS ZENTRUM', 'PARKSCHEINAUTOMAT MUSTERSTADT', 'PARKHAUS AM KLINIKUM'],
    min: 1.5,
    max: 12,
  },
  {
    category: 'bargeld',
    rate: (): number => 0.04,
    account: giro,
    merchants: ['GA TESTBANK MUSTERSTADT'],
    min: 20,
    max: 200,
  },
  {
    category: 'essen',
    rate: (): number => 0.3,
    account: giro,
    merchants: ['KIOSK EIS UND ZEITUNG', 'SPAETI ZUM DURST', 'EISDIELE VENEZIA'],
    min: 1.2,
    max: 12,
  },
  {
    category: 'ausgehen',
    rate: (day: Day): number => (day >= EMIL_BORN ? 0.015 : 0.06),
    account: creditCard,
    merchants: [
      'KINO LICHTSPIELE ZUKUNFT',
      'KONZERTHAUS KLANGFABRIK',
      'BAR ZUM SCHLUMMERTRUNK',
      'KLETTERHALLE GRIFFIG',
    ],
    min: 8,
    max: 45,
  },
  {
    category: 'apotheke',
    rate: (day: Day): number => {
      if (babyMonths(day)) return 0.12;
      return day >= PREGNANCY_KNOWN ? 0.05 : 0.025;
    },
    account: shared(0.7),
    merchants: ['LOEWENZAHN-APOTHEKE', 'APOTHEKE AM MARKT'],
    min: 4,
    max: 48,
  },
  {
    category: 'baumarkt',
    rate: (day: Day): number => {
      if (day >= HOUSE_HANDOVER && day < RENOVATION_END) return 0.3;
      if (day >= HOUSE_HANDOVER) return 0.03;
      if (day >= BIGGER_FLAT - 21 && day < BIGGER_FLAT + 30) return 0.2;
      return 0.01;
    },
    account: shared(0.8),
    merchants: ['HAMMERBACH BAUMARKT'],
    min: 4,
    max: 380,
    repeat: (day: Day): number => (day >= HOUSE_HANDOVER && day < RENOVATION_END ? 0.45 : 0.1),
  },
  {
    category: 'gadgets',
    rate: (): number => 0.008,
    account: creditCard,
    merchants: ['ELEKTROMARKT VOLTWERK', 'TECHNIKTRUHE VERSAND'],
    min: 15,
    max: 350,
  },
  {
    category: 'baby',
    rate: (day: Day): number => (day >= EMIL_BORN - 60 && day < dayOf(2026, 1, 1) ? 0.08 : 0),
    account: shared(0.9),
    merchants: ['STRAMPELHAUS BABYMARKT', 'KINDERLADEN ZWERGENSTARK', 'SECOND-HAND-KINDERKRAM'],
    min: 8,
    max: 120,
  },
  {
    category: 'geschenk',
    rate: (): number => 0.015,
    account: mixed(0.5),
    merchants: ['GESCHENKEHAUS SCHLEIFCHEN', 'BLUMEN BLUETENZAUBER'],
    min: 10,
    max: 80,
  },
];

/** Share of online purchases that go back, refunded two to three weeks later. */
const RETURN_SHARE = 0.07;

export interface HabitDay {
  readonly day: Day;
  readonly traveling: boolean;
}

/** Books whatever Tobias and his household buy on `day` out of habit. */
export function bookHabits(ctx: StoryContext, today: HabitDay): void {
  const damping: number = today.traveling ? TRAVEL_DAMPING : 1;
  for (const habit of HABITS) {
    let count: number = ctx.rng.count(habit.rate(today.day) * ACTIVITY * damping);
    if (count > 0 && habit.repeat !== undefined) {
      while (count < 6 && ctx.rng.chance(habit.repeat(today.day))) count++;
    }
    for (let visit = 1; visit <= count; visit++) {
      bookVisit(ctx, { habit, day: today.day, visit });
    }
  }
}

interface Visit {
  readonly habit: Habit;
  readonly day: Day;
  /** 1 for the first visit of the day at this kind of shop, 2 for the second, … */
  readonly visit: number;
}

function bookVisit(ctx: StoryContext, params: Visit): void {
  const habit: Habit = params.habit;
  const account: AccountKey = habit.account(ctx, params.day);
  const scaled: number =
    ctx.rng.cents(habit.min, habit.max) *
    priceIndex(params.day) *
    (habit.perPerson ? householdSize(params.day) : 1);
  if (habit.category === 'bargeld') {
    bookCash(ctx, params.day);
    return;
  }
  const name: string =
    habit.category === 'kantine'
      ? params.day >= JOB_CHANGE
        ? `BETRIEBSRESTAURANT ${NEW_EMPLOYER.toUpperCase()}`
        : `KANTINE ${OLD_EMPLOYER.toUpperCase()}`
      : ctx.rng.pick(habit.merchants);
  const cents: number = -Math.max(50, Math.round(scaled));
  pay(ctx, {
    day: params.day,
    account,
    cents,
    name,
    zweck:
      habit.category === 'baumarkt' && params.visit > 1
        ? `${name} – ${params.visit}. Besuch heute`
        : undefined,
    category: habit.category,
  });
  if (habit.category === 'online' && ctx.rng.chance(RETURN_SHARE)) {
    pay(ctx, {
      day: params.day + ctx.rng.int(12, 24),
      account,
      cents: -cents,
      name,
      zweck: `${name} GUTSCHRIFT RETOURE`,
      category: 'erstattungen',
    });
  }
}

const CASH_AMOUNTS: readonly number[] = [20, 50, 50, 100, 100, 150, 200];

function bookCash(ctx: StoryContext, day: Day): void {
  pay(ctx, {
    day,
    account: 'giro',
    cents: -ctx.rng.pick(CASH_AMOUNTS) * 100,
    name: 'GA TESTBANK MUSTERSTADT',
    zweck: 'Bargeldauszahlung GA 4711 Musterstadt',
    art: 'Bargeldauszahlung',
    category: 'bargeld',
  });
}
