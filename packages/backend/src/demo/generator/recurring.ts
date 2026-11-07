import type { AccountKey } from './accounts';
import { daysInMonth, dayOf, monthLabel, monthOf, parseDay, yearOf } from './calendar';
import type { Day } from './calendar';
import type { CategoryKey } from './categories';
import type { Art } from './ledger';
import { euros, pay } from './payments';
import type { StoryContext } from './payments';
import {
  BIGGER_FLAT,
  D_TICKET,
  hasJointAccount,
  HOUSE_HANDOVER,
  JOINT_ACCOUNT_OPENED,
  KITA_START,
  SABINE_MOVES_IN,
  STORY_START,
} from './timeline';

/** A bill or income that repeats every month (or in the listed months) on a fixed day. */
interface Recurring {
  readonly name: string;
  readonly from: Day;
  /** Exclusive. */
  readonly until?: Day;
  readonly dayOfMonth: number;
  readonly months?: readonly number[];
  readonly account: AccountKey | ((day: Day) => AccountKey);
  readonly art: Art;
  readonly category: CategoryKey;
  /** Signed cents. */
  readonly cents: (day: Day) => number;
  readonly zweck: (day: Day) => string;
  readonly mandate?: boolean;
  readonly kommentar?: (day: Day) => string | undefined;
}

type Step = readonly [string, number];

/** Amounts that change on given dates: the euros of the last step on or before the day. */
function stepped(steps: readonly Step[]): (day: Day) => number {
  const parsed: readonly (readonly [Day, number])[] = steps.map(
    ([date, amount]: Step): readonly [Day, number] => [parseDay(date), euros(amount)],
  );
  return (day: Day): number => {
    let result: number | null = null;
    for (const [from, cents] of parsed) if (from <= day) result = cents;
    if (result === null) throw new Error(`No amount step before ${day}`);
    return result;
  };
}

function withMonth(text: string): (day: Day) => string {
  return (day: Day): string => `${text} ${monthLabel(yearOf(day), monthOf(day))}`;
}

function fixed(text: string): () => string {
  return (): string => text;
}

function household(day: Day): AccountKey {
  return hasJointAccount(day) ? 'gemeinschaft' : 'giro';
}

const QUARTERLY: readonly number[] = [1, 4, 7, 10];

const RECURRING: readonly Recurring[] = [
  {
    name: 'Hausverwaltung Bröselmann',
    from: STORY_START,
    until: BIGGER_FLAT,
    dayOfMonth: 1,
    account: 'giro',
    art: 'Dauerauftrag',
    category: 'miete',
    cents: stepped([
      ['2014-01-01', -445],
      ['2015-07-01', -455],
    ]),
    zweck: withMonth('Miete Rosenweg 7, 3. OG links, Whg. 12'),
  },
  {
    name: 'Wohnbau Hochglanz GmbH',
    from: BIGGER_FLAT,
    until: HOUSE_HANDOVER,
    dayOfMonth: 1,
    account: household,
    art: 'Dauerauftrag',
    category: 'miete',
    cents: stepped([
      ['2016-09-01', -690],
      ['2019-01-01', -725],
    ]),
    zweck: withMonth('Miete inkl. NK Ahornallee 12, WE 08'),
    kommentar: (day: Day): string | undefined =>
      day === dayOf(2019, 1, 1)
        ? 'Mieterhöhung wegen "gehobener Ausstattung". Die Klingel geht wieder.'
        : undefined,
  },
  {
    name: 'Sabine Beispiel',
    from: SABINE_MOVES_IN,
    until: JOINT_ACCOUNT_OPENED,
    dayOfMonth: 2,
    account: 'giro',
    art: 'Gutschrift',
    category: 'sonstigeEinnahmen',
    cents: stepped([['2019-10-01', 360]]),
    zweck: withMonth('Mietanteil Sabine <3'),
  },
  {
    name: 'Stromlieferant Funkenflug GmbH',
    from: STORY_START,
    dayOfMonth: 15,
    account: household,
    art: 'Lastschrift',
    category: 'energie',
    mandate: true,
    cents: stepped([
      ['2014-01-01', -36],
      ['2015-01-01', -39],
      ['2016-09-01', -58],
      ['2019-10-01', -64],
      ['2021-04-01', -118],
      ['2022-11-01', -164],
      ['2024-03-01', -138],
      ['2025-06-01', -129],
    ]),
    zweck: withMonth('Abschlag Strom Vertragskonto 3004711'),
  },
  {
    name: 'Gaswerk Flämmchen AG',
    from: HOUSE_HANDOVER,
    dayOfMonth: 15,
    account: 'gemeinschaft',
    art: 'Lastschrift',
    category: 'energie',
    mandate: true,
    cents: stepped([
      ['2021-04-01', -110],
      ['2022-10-01', -265],
      ['2024-01-01', -205],
      ['2025-06-01', -180],
    ]),
    zweck: withMonth('Abschlag Erdgas Altbau Lindenweg 3'),
    kommentar: (day: Day): string | undefined =>
      day === dayOf(2022, 10, 15) ? 'Pullover-Saison ab sofort ganzjährig.' : undefined,
  },
  {
    name: 'Wasserverband Tröpfelbach',
    from: HOUSE_HANDOVER,
    dayOfMonth: 20,
    account: 'gemeinschaft',
    art: 'Lastschrift',
    category: 'energie',
    mandate: true,
    cents: stepped([
      ['2021-04-01', -42],
      ['2024-01-01', -47],
    ]),
    zweck: withMonth('Abschlag Wasser/Abwasser'),
  },
  {
    name: 'Netzbrei Telekommunikation',
    from: STORY_START,
    dayOfMonth: 5,
    account: 'giro',
    art: 'Lastschrift',
    category: 'internetTelefon',
    mandate: true,
    cents: stepped([
      ['2014-01-01', -29.99],
      ['2021-04-01', -44.99],
    ]),
    zweck: withMonth('Kundennr. 77123 DSL Rechnung'),
  },
  {
    name: 'Quasselfunk Mobil',
    from: STORY_START,
    dayOfMonth: 8,
    account: 'giro',
    art: 'Lastschrift',
    category: 'internetTelefon',
    mandate: true,
    cents: stepped([
      ['2014-01-01', -19.99],
      ['2018-02-01', -14.99],
      ['2022-05-01', -24.99],
    ]),
    zweck: withMonth('Mobilfunkrechnung Tarif Plappermaul L'),
  },
  {
    name: 'Rundfunkbeitragsstelle Musterland',
    from: STORY_START,
    dayOfMonth: 15,
    months: QUARTERLY,
    account: household,
    art: 'Lastschrift',
    category: 'internetTelefon',
    mandate: true,
    cents: stepped([
      ['2014-01-01', -53.94],
      ['2015-04-01', -52.5],
      ['2021-08-01', -55.08],
    ]),
    zweck: withMonth('Rundfunkbeitrag Beitragsnr. 471 108 15 Quartal ab'),
  },
  {
    name: 'FLIMMERKISTE+',
    from: STORY_START,
    dayOfMonth: 3,
    account: 'kreditkarte',
    art: 'Kartenzahlung',
    category: 'streaming',
    cents: stepped([
      ['2014-01-01', -7.99],
      ['2017-06-01', -9.99],
      ['2021-03-01', -12.99],
      ['2024-02-01', -13.99],
    ]),
    zweck: fixed('FLIMMERKISTE+ ABO MONATLICH'),
  },
  {
    name: 'DUDELFY MUSIK',
    from: dayOf(2015, 3, 1),
    dayOfMonth: 21,
    account: 'kreditkarte',
    art: 'Kartenzahlung',
    category: 'streaming',
    cents: stepped([
      ['2015-03-01', -9.99],
      ['2020-06-01', -14.99],
      ['2023-07-01', -16.99],
      ['2025-04-01', -17.99],
    ]),
    zweck: fixed('DUDELFY MUSIK PREMIUM'),
  },
  {
    name: 'SERIENMARATHON TV',
    from: dayOf(2019, 4, 1),
    dayOfMonth: 11,
    account: 'kreditkarte',
    art: 'Kartenzahlung',
    category: 'streaming',
    cents: stepped([
      ['2019-04-01', -5.99],
      ['2023-01-01', -8.99],
    ]),
    zweck: fixed('SERIENMARATHON TV ABO'),
  },
  {
    name: 'ZEN10 YOGA APP',
    from: dayOf(2016, 1, 1),
    until: dayOf(2024, 3, 1),
    dayOfMonth: 14,
    account: 'kreditkarte',
    art: 'Kartenzahlung',
    category: 'streaming',
    cents: stepped([['2016-01-01', -11.99]]),
    zweck: fixed('ZEN10 YOGA APP PREMIUM MONATLICH'),
    kommentar: (day: Day): string | undefined =>
      day === dayOf(2019, 1, 14) ? 'Was ist ZEN10?? Später nachschauen.' : undefined,
  },
  {
    name: 'Fitnessstudio Muskelkater',
    from: dayOf(2014, 3, 1),
    until: dayOf(2020, 1, 1),
    dayOfMonth: 1,
    account: 'giro',
    art: 'Lastschrift',
    category: 'sport',
    mandate: true,
    cents: stepped([
      ['2014-03-01', -29.9],
      ['2017-01-01', -34.9],
    ]),
    zweck: withMonth('Mitgliedsbeitrag Nr. 0815'),
    kommentar: (day: Day): string | undefined =>
      day === dayOf(2014, 3, 1) ? 'Ab jetzt 3x die Woche!' : undefined,
  },
  {
    name: 'Testbank Musterstadt',
    from: dayOf(2019, 7, 1),
    dayOfMonth: 28,
    account: 'giro',
    art: 'Entgelt',
    category: 'gebuehren',
    cents: stepped([
      ['2019-07-01', -4.9],
      ['2023-01-01', -6.9],
    ]),
    zweck: withMonth('Kontoführungsentgelt'),
    kommentar: (day: Day): string | undefined =>
      day === dayOf(2019, 7, 28) ? 'Seit wann kostet das Konto Geld?!' : undefined,
  },
  {
    name: 'Testbank Musterstadt',
    from: STORY_START,
    dayOfMonth: 1,
    months: [2],
    account: 'kreditkarte',
    art: 'Entgelt',
    category: 'gebuehren',
    cents: stepped([
      ['2014-01-01', -29],
      ['2022-01-01', -39],
    ]),
    zweck: (day: Day): string => `Jahresentgelt Kreditkarte ${yearOf(day)}`,
  },
  {
    name: 'Sorgenfrei Versicherung AG',
    from: STORY_START,
    dayOfMonth: 2,
    months: [1],
    account: 'giro',
    art: 'Lastschrift',
    category: 'haftpflicht',
    mandate: true,
    cents: stepped([
      ['2014-01-01', -72.4],
      ['2020-01-01', -98.1],
      ['2024-01-01', -104.6],
    ]),
    zweck: (day: Day): string => `Privathaftpflicht Vertrag PH-55123 Beitrag ${yearOf(day)}`,
  },
  {
    name: 'Sorgenfrei Versicherung AG',
    from: STORY_START,
    dayOfMonth: 1,
    months: [2],
    account: household,
    art: 'Lastschrift',
    category: 'hausrat',
    mandate: true,
    cents: stepped([
      ['2014-01-01', -58.2],
      ['2017-01-01', -84.9],
      ['2022-01-01', -162.3],
      ['2024-01-01', -171],
    ]),
    zweck: (day: Day): string => `Hausrat Vertrag HR-90210 Beitrag ${yearOf(day)}`,
  },
  {
    name: 'Lebenswerk Versicherung a.G.',
    from: dayOf(2015, 4, 1),
    dayOfMonth: 1,
    account: 'giro',
    art: 'Lastschrift',
    category: 'vorsorge',
    mandate: true,
    cents: stepped([
      ['2015-04-01', -52.3],
      ['2022-01-01', -58.1],
    ]),
    zweck: withMonth('Berufsunfähigkeit BU-4711 Beitrag'),
  },
  {
    name: 'Lebenswerk Versicherung a.G.',
    from: HOUSE_HANDOVER,
    dayOfMonth: 1,
    account: 'gemeinschaft',
    art: 'Lastschrift',
    category: 'vorsorge',
    mandate: true,
    cents: stepped([['2021-04-01', -28.5]]),
    zweck: withMonth('Risikolebensversicherung RL-0042 verb. Leben'),
  },
  {
    name: 'Beißfest Zahnzusatz VVaG',
    from: dayOf(2017, 1, 1),
    dayOfMonth: 1,
    account: 'giro',
    art: 'Lastschrift',
    category: 'zahnzusatz',
    mandate: true,
    cents: stepped([
      ['2017-01-01', -18.9],
      ['2023-01-01', -24.4],
    ]),
    zweck: withMonth('Zahnzusatztarif Strahlemann Beitrag'),
  },
  {
    name: 'Sorgenfrei Versicherung AG',
    from: HOUSE_HANDOVER,
    dayOfMonth: 1,
    months: [4],
    account: 'gemeinschaft',
    art: 'Lastschrift',
    category: 'gebaeude',
    mandate: true,
    cents: stepped([
      ['2021-04-01', -612],
      ['2023-01-01', -689],
      ['2025-01-01', -742],
    ]),
    zweck: (day: Day): string => `Wohngebäude WG-1904 inkl. Elementar ${yearOf(day)}`,
  },
  {
    name: 'Blechschaden Versicherungs-AG',
    from: dayOf(2019, 1, 1),
    dayOfMonth: 1,
    months: [1],
    account: 'giro',
    art: 'Lastschrift',
    category: 'kfzVersicherung',
    mandate: true,
    cents: stepped([
      ['2019-01-01', -538],
      ['2023-01-01', -611],
      ['2025-01-01', -689],
    ]),
    zweck: (day: Day): string => `Kfz-Haftpflicht/Teilkasko MU-TT 1337 Beitrag ${yearOf(day)}`,
  },
  {
    name: 'Bundeskasse Kfz-Steuer',
    from: dayOf(2019, 1, 1),
    dayOfMonth: 20,
    months: [4],
    account: 'giro',
    art: 'Lastschrift',
    category: 'kfzVersicherung',
    mandate: true,
    cents: stepped([['2019-01-01', -186]]),
    zweck: (day: Day): string => `Kfz-Steuer MU-TT 1337 ${yearOf(day)}/${yearOf(day) + 1}`,
  },
  {
    name: 'GLANZWERK WASCHFLATRATE',
    from: dayOf(2018, 5, 1),
    dayOfMonth: 1,
    account: 'kreditkarte',
    art: 'Kartenzahlung',
    category: 'autopflege',
    cents: stepped([
      ['2018-05-01', -14.99],
      ['2022-01-01', -17.99],
    ]),
    zweck: fixed('GLANZWERK WASCHFLATRATE PREMIUM-SCHAUM'),
    kommentar: (day: Day): string | undefined =>
      day === dayOf(2021, 5, 1) ? 'Wie oft waren wir da? Einmal. 2018.' : undefined,
  },
  {
    name: 'Tierheim Pfötchenglück e.V.',
    from: dayOf(2017, 6, 1),
    dayOfMonth: 10,
    account: 'giro',
    art: 'Dauerauftrag',
    category: 'spenden',
    cents: stepped([
      ['2017-06-01', -10],
      ['2022-01-01', -15],
    ]),
    zweck: fixed('Spende Patenschaft Kater Brummbär'),
  },
  {
    name: 'Depotbank Zinseszins AG',
    from: dayOf(2022, 5, 1),
    dayOfMonth: 2,
    account: 'giro',
    art: 'Dauerauftrag',
    category: 'umbuchung',
    cents: stepped([
      ['2022-05-01', -300],
      ['2024-01-01', -400],
    ]),
    zweck: fixed('ETF-Sparplan Depot 9988776 Welt-Index'),
  },
  {
    name: 'Stadtkasse Musterstadt',
    from: dayOf(2021, 5, 1),
    dayOfMonth: 15,
    months: [2, 5, 8, 11],
    account: 'gemeinschaft',
    art: 'Lastschrift',
    category: 'grundabgaben',
    mandate: true,
    cents: stepped([
      ['2021-05-01', -148.2],
      ['2025-01-01', -171.9],
    ]),
    zweck: withMonth('Grundsteuer B Kassenzeichen 4.711.0815 Fälligkeit'),
    kommentar: (day: Day): string | undefined =>
      day === dayOf(2025, 2, 15) ? 'Grundsteuerreform: jetzt anders falsch.' : undefined,
  },
  {
    name: 'Abfallwirtschaft Musterkreis',
    from: dayOf(2022, 1, 1),
    dayOfMonth: 1,
    months: [3],
    account: 'gemeinschaft',
    art: 'Lastschrift',
    category: 'grundabgaben',
    mandate: true,
    cents: stepped([
      ['2022-01-01', -286.4],
      ['2025-01-01', -311.2],
    ]),
    zweck: (day: Day): string => `Abfallgebühren ${yearOf(day)} Lindenweg 3 (120 l Restmüll)`,
  },
  {
    name: 'Bezirksschornsteinfeger Rußmann',
    from: HOUSE_HANDOVER,
    dayOfMonth: 12,
    months: [10],
    account: 'gemeinschaft',
    art: 'Überweisung',
    category: 'handwerker',
    cents: stepped([
      ['2021-01-01', -89.4],
      ['2024-01-01', -96.8],
    ]),
    zweck: (day: Day): string => `Feuerstättenschau/Messung ${yearOf(day)} Rg. ${yearOf(day)}-77`,
  },
  {
    name: 'WOLKENSPEICHER',
    from: dayOf(2021, 1, 1),
    dayOfMonth: 26,
    account: 'kreditkarte',
    art: 'Kartenzahlung',
    category: 'streaming',
    cents: stepped([
      ['2021-01-01', -2.99],
      ['2023-04-01', -9.99],
    ]),
    zweck: (day: Day): string =>
      day < dayOf(2023, 4, 1) ? 'WOLKENSPEICHER 200 GB' : 'WOLKENSPEICHER 2 TB (EMIL-FOTOS)',
  },
  {
    name: 'Kita Purzelbaum e.V.',
    from: KITA_START,
    dayOfMonth: 1,
    account: 'gemeinschaft',
    art: 'Lastschrift',
    category: 'kita',
    mandate: true,
    cents: stepped([
      ['2024-08-01', -268],
      ['2025-08-01', -284],
    ]),
    zweck: withMonth('Elternbeitrag Emil Testmann Gruppe Raupen'),
  },
  {
    name: 'Kita Purzelbaum e.V.',
    from: KITA_START,
    dayOfMonth: 1,
    account: 'gemeinschaft',
    art: 'Lastschrift',
    category: 'kita',
    mandate: true,
    cents: stepped([
      ['2024-08-01', -72],
      ['2026-01-01', -78],
    ]),
    zweck: withMonth('Verpflegungsgeld Emil Testmann'),
  },
  {
    name: 'Familienkasse Musterland',
    from: dayOf(2023, 5, 1),
    dayOfMonth: 7,
    account: 'gemeinschaft',
    art: 'Gutschrift',
    category: 'kindergeld',
    cents: stepped([
      ['2023-01-01', 250],
      ['2025-01-01', 255],
      ['2026-01-01', 259],
    ]),
    zweck: withMonth('Kindergeld KG-Nr. 123FK456789 Emil'),
  },
  {
    name: 'Verkehrsverbund Musterland',
    from: D_TICKET,
    dayOfMonth: 1,
    account: 'giro',
    art: 'Lastschrift',
    category: 'oepnv',
    mandate: true,
    cents: stepped([
      ['2023-05-01', -49],
      ['2025-01-01', -58],
      ['2026-01-01', -63],
    ]),
    zweck: withMonth('Deutschlandweit-Abo'),
  },
];

/** Books every recurring item due in the given month. */
export function bookRecurring(ctx: StoryContext, params: { year: number; month: number }): void {
  for (const item of RECURRING) {
    if (item.months !== undefined && !item.months.includes(params.month)) continue;
    const day: Day = dayOf(
      params.year,
      params.month,
      Math.min(item.dayOfMonth, daysInMonth(params.year, params.month)),
    );
    if (day < item.from || (item.until !== undefined && day >= item.until)) continue;
    pay(ctx, {
      day,
      account: typeof item.account === 'function' ? item.account(day) : item.account,
      cents: item.cents(day),
      name: item.name,
      zweck: item.zweck(day),
      art: item.art,
      category: item.category,
      mandate: item.mandate,
      kommentar: item.kommentar?.(day),
    });
  }
}
