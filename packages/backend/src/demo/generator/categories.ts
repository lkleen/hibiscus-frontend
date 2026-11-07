import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import type { TaxSectionCode, TaxTag } from '@hibiscus-frontend/shared/contracts/tax-tags';

/** Hibiscus `umsatztyp.umsatztyp`: 0 = expense, 1 = income, 2 = neutral (transfers). */
const EXPENSE = 0;
const INCOME = 1;
const NEUTRAL = 2;

/** Every demo category; the story books against these keys. */
export type CategoryKey =
  | 'einkommen'
  | 'gehalt'
  | 'kindergeld'
  | 'erstattungen'
  | 'zinsen'
  | 'sonstigeEinnahmen'
  | 'wohnen'
  | 'miete'
  | 'energie'
  | 'internetTelefon'
  | 'einrichtung'
  | 'handwerker'
  | 'baumarkt'
  | 'kreditzinsen'
  | 'grundabgaben'
  | 'essen'
  | 'supermarkt'
  | 'baecker'
  | 'restaurant'
  | 'lieferdienst'
  | 'kantine'
  | 'mobilitaet'
  | 'tanken'
  | 'werkstatt'
  | 'kfzVersicherung'
  | 'autopflege'
  | 'parken'
  | 'oepnv'
  | 'versicherungen'
  | 'haftpflicht'
  | 'hausrat'
  | 'vorsorge'
  | 'zahnzusatz'
  | 'gebaeude'
  | 'freizeit'
  | 'streaming'
  | 'sport'
  | 'ausgehen'
  | 'gadgets'
  | 'einkaufen'
  | 'online'
  | 'kleidung'
  | 'drogerie'
  | 'kurioses'
  | 'reisen'
  | 'transport'
  | 'unterkunft'
  | 'urlaubVorOrt'
  | 'familie'
  | 'baby'
  | 'kita'
  | 'gesundheit'
  | 'apotheke'
  | 'arzt'
  | 'geschenke'
  | 'geschenk'
  | 'hochzeit'
  | 'spenden'
  | 'beruf'
  | 'bank'
  | 'bargeld'
  | 'umbuchung'
  | 'gebuehren';

interface CategoryDef {
  readonly id: number;
  readonly name: string;
  readonly parent: CategoryKey | null;
  readonly type: number;
  /** `r,g,b`, set on root categories only. */
  readonly color?: string;
  /** A Hibiscus regex pattern, like a user would set up for automatic categorisation. */
  readonly pattern?: string;
  readonly kommentar?: string;
}

/** The category tree, Hibiscus-like: root groups with their sub-categories. */
const CATEGORIES: Record<CategoryKey, CategoryDef> = {
  einkommen: { id: 1, name: 'Einkommen', parent: null, type: INCOME, color: '46,139,87' },
  gehalt: {
    id: 2,
    name: 'Gehalt',
    parent: 'einkommen',
    type: INCOME,
    pattern: 'LOHN/GEHALT|Kurzarbeit',
  },
  kindergeld: {
    id: 3,
    name: 'Kindergeld',
    parent: 'einkommen',
    type: INCOME,
    pattern: 'Familienkasse',
  },
  erstattungen: { id: 4, name: 'Erstattungen & Retouren', parent: 'einkommen', type: INCOME },
  zinsen: { id: 5, name: 'Zinsen', parent: 'einkommen', type: INCOME },
  sonstigeEinnahmen: { id: 6, name: 'Sonstige Einnahmen', parent: 'einkommen', type: INCOME },

  wohnen: { id: 10, name: 'Wohnen', parent: null, type: EXPENSE, color: '70,130,180' },
  miete: { id: 11, name: 'Miete', parent: 'wohnen', type: EXPENSE },
  energie: { id: 12, name: 'Strom, Gas & Wasser', parent: 'wohnen', type: EXPENSE },
  internetTelefon: { id: 13, name: 'Internet & Telefon', parent: 'wohnen', type: EXPENSE },
  einrichtung: { id: 14, name: 'Einrichtung & Haushalt', parent: 'wohnen', type: EXPENSE },
  handwerker: {
    id: 15,
    name: 'Handwerker',
    parent: 'wohnen',
    type: EXPENSE,
    kommentar: 'Arbeitslohn aus der Rechnung für §35a heraussuchen',
  },
  baumarkt: {
    id: 16,
    name: 'Baumarkt & Renovierung',
    parent: 'wohnen',
    type: EXPENSE,
    pattern: 'Hammerbach',
  },
  kreditzinsen: { id: 17, name: 'Kreditzinsen', parent: 'wohnen', type: EXPENSE },
  grundabgaben: { id: 18, name: 'Grundsteuer & Abgaben', parent: 'wohnen', type: EXPENSE },

  essen: { id: 20, name: 'Essen & Trinken', parent: null, type: EXPENSE, color: '218,165,32' },
  supermarkt: {
    id: 21,
    name: 'Supermarkt',
    parent: 'essen',
    type: EXPENSE,
    pattern: 'FRISCHEKORB|SPARMARKT|PREISWUT|BIO-OASE',
  },
  baecker: { id: 22, name: 'Bäcker & Café', parent: 'essen', type: EXPENSE },
  restaurant: { id: 23, name: 'Restaurant', parent: 'essen', type: EXPENSE },
  lieferdienst: { id: 24, name: 'Lieferdienst', parent: 'essen', type: EXPENSE },
  kantine: { id: 25, name: 'Kantine', parent: 'essen', type: EXPENSE },

  mobilitaet: { id: 30, name: 'Mobilität', parent: null, type: EXPENSE, color: '178,34,34' },
  tanken: { id: 31, name: 'Tanken', parent: 'mobilitaet', type: EXPENSE, pattern: 'ZAPFHAHN' },
  werkstatt: { id: 32, name: 'Werkstatt & TÜV', parent: 'mobilitaet', type: EXPENSE },
  kfzVersicherung: {
    id: 33,
    name: 'Kfz-Versicherung & Steuer',
    parent: 'mobilitaet',
    type: EXPENSE,
  },
  autopflege: { id: 34, name: 'Autopflege', parent: 'mobilitaet', type: EXPENSE },
  parken: { id: 35, name: 'Parken & Knöllchen', parent: 'mobilitaet', type: EXPENSE },
  oepnv: { id: 36, name: 'ÖPNV & Bahn', parent: 'mobilitaet', type: EXPENSE },

  versicherungen: {
    id: 40,
    name: 'Versicherungen',
    parent: null,
    type: EXPENSE,
    color: '106,90,205',
  },
  haftpflicht: { id: 41, name: 'Privathaftpflicht', parent: 'versicherungen', type: EXPENSE },
  hausrat: { id: 42, name: 'Hausrat', parent: 'versicherungen', type: EXPENSE },
  vorsorge: {
    id: 43,
    name: 'Berufsunfähigkeit & Leben',
    parent: 'versicherungen',
    type: EXPENSE,
  },
  zahnzusatz: { id: 44, name: 'Zahnzusatz', parent: 'versicherungen', type: EXPENSE },
  gebaeude: { id: 45, name: 'Wohngebäude', parent: 'versicherungen', type: EXPENSE },

  freizeit: { id: 50, name: 'Freizeit', parent: null, type: EXPENSE, color: '255,127,80' },
  streaming: { id: 51, name: 'Streaming & Abos', parent: 'freizeit', type: EXPENSE },
  sport: { id: 52, name: 'Sport', parent: 'freizeit', type: EXPENSE },
  ausgehen: { id: 53, name: 'Ausgehen & Kultur', parent: 'freizeit', type: EXPENSE },
  gadgets: { id: 54, name: 'Elektronik & Gadgets', parent: 'freizeit', type: EXPENSE },

  einkaufen: { id: 55, name: 'Einkaufen', parent: null, type: EXPENSE, color: '199,21,133' },
  online: { id: 56, name: 'Online-Shopping', parent: 'einkaufen', type: EXPENSE },
  kleidung: { id: 57, name: 'Kleidung', parent: 'einkaufen', type: EXPENSE },
  drogerie: { id: 58, name: 'Drogerie', parent: 'einkaufen', type: EXPENSE },
  kurioses: {
    id: 59,
    name: 'Kurioses',
    parent: 'einkaufen',
    type: EXPENSE,
    kommentar: 'Sabine nennt diese Kategorie anders.',
  },

  reisen: { id: 60, name: 'Reisen', parent: null, type: EXPENSE, color: '0,139,139' },
  transport: { id: 61, name: 'Flüge & Fernzüge', parent: 'reisen', type: EXPENSE },
  unterkunft: { id: 62, name: 'Unterkunft', parent: 'reisen', type: EXPENSE },
  urlaubVorOrt: { id: 63, name: 'Urlaub vor Ort', parent: 'reisen', type: EXPENSE },

  familie: { id: 70, name: 'Familie & Kind', parent: null, type: EXPENSE, color: '255,182,193' },
  baby: { id: 71, name: 'Babyausstattung', parent: 'familie', type: EXPENSE },
  kita: { id: 72, name: 'Kita & Betreuung', parent: 'familie', type: EXPENSE },

  gesundheit: { id: 80, name: 'Gesundheit', parent: null, type: EXPENSE, color: '60,179,113' },
  apotheke: { id: 81, name: 'Apotheke', parent: 'gesundheit', type: EXPENSE },
  arzt: { id: 82, name: 'Arzt & Zahnarzt', parent: 'gesundheit', type: EXPENSE },

  geschenke: {
    id: 90,
    name: 'Geschenke & Feiern',
    parent: null,
    type: EXPENSE,
    color: '186,85,211',
  },
  geschenk: { id: 91, name: 'Geschenke', parent: 'geschenke', type: EXPENSE },
  hochzeit: { id: 92, name: 'Hochzeit', parent: 'geschenke', type: EXPENSE },

  spenden: { id: 95, name: 'Spenden', parent: null, type: EXPENSE, color: '255,215,0' },
  beruf: { id: 96, name: 'Beruf & Fortbildung', parent: null, type: EXPENSE, color: '105,105,105' },

  bank: { id: 100, name: 'Bank & Umbuchungen', parent: null, type: NEUTRAL, color: '128,128,128' },
  bargeld: { id: 101, name: 'Bargeld', parent: 'bank', type: NEUTRAL },
  umbuchung: { id: 102, name: 'Umbuchung', parent: 'bank', type: NEUTRAL },
  gebuehren: { id: 103, name: 'Gebühren', parent: 'bank', type: EXPENSE },
};

/** Categories tagged for the tax overview; codes are from `DEFAULT_TAX_SECTIONS`. */
const TAX_TAGS: readonly (readonly [CategoryKey, TaxSectionCode])[] = [
  ['handwerker', 'St-HH'],
  ['kita', 'St-KI'],
  ['spenden', 'St-SA'],
  ['gesundheit', 'St-AB'],
  ['haftpflicht', 'St-VA'],
  ['vorsorge', 'St-VA'],
  ['zahnzusatz', 'St-VA'],
  ['beruf', 'St-WK'],
];

export function categoryId(key: CategoryKey): number {
  return CATEGORIES[key].id;
}

export function buildCategories(): CategoryRow[] {
  const keys: CategoryKey[] = Object.keys(CATEGORIES) as CategoryKey[];
  return keys.map((key: CategoryKey): CategoryRow => {
    const def: CategoryDef = CATEGORIES[key];
    return {
      id: def.id,
      name: def.name,
      nummer: null,
      pattern: def.pattern ?? null,
      isregex: def.pattern === undefined ? null : 1,
      umsatztyp: def.type,
      parent_id: def.parent === null ? null : CATEGORIES[def.parent].id,
      color: def.color ?? null,
      customcolor: def.color === undefined ? null : 1,
      kommentar: def.kommentar ?? null,
      konto_id: null,
      konto_kategorie: null,
      flags: key === 'umbuchung' ? 1 : 0,
    };
  });
}

export function buildTaxTags(): TaxTag[] {
  return TAX_TAGS.map(([key, code]: readonly [CategoryKey, TaxSectionCode]): TaxTag => ({
    category_id: categoryId(key),
    code,
  }));
}
