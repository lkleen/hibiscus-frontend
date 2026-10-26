import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import type { TaxSectionCode, TaxTagCode } from '@hibiscus-frontend/shared/contracts/tax-tags';
import type { TaxSituation } from '@hibiscus-frontend/shared/contracts/user-settings';

/** Marks a category (and everything below it) as not tax-relevant; stops inheritance. */
export const TAX_EXCLUDED_CODE: Extract<TaxTagCode, 'St-0'> = 'St-0';

export interface TaxSection {
  readonly code: TaxSectionCode;
  /** i18n keys: `tax.sections.<id>.name`, `.guidance`, `.form` where id = code without 'St-' lowercased (wk, va, sa, ab, hh, ki, v). */
  readonly nameKey: string;
  readonly guidanceKey: string;
  readonly formKey: string;
  /** Lower-case German keywords matched against a category's own name for suggestions. */
  readonly keywords: readonly string[];
  /** The life-situation answer that enables it; null = always enabled. */
  readonly enabledBy: TaxSituation | null;
}

function section(
  code: TaxSectionCode,
  enabledBy: TaxSituation | null,
  keywords: readonly string[],
): TaxSection {
  const id: string = code.slice('St-'.length).toLowerCase();
  return {
    code,
    nameKey: `tax.sections.${id}.name`,
    guidanceKey: `tax.sections.${id}.guidance`,
    formKey: `tax.sections.${id}.form`,
    keywords,
    enabledBy,
  };
}

/** Order matters for suggestions: the first section with a matching keyword wins (VA before AB). */
export const TAX_SECTIONS: readonly TaxSection[] = [
  section('St-WK', 'employed', [
    'arbeitsmittel',
    'fortbildung',
    'weiterbildung',
    'fachliteratur',
    'gewerkschaft',
    'berufsverband',
    'fahrtkosten',
    'pendler',
    'arbeitszimmer',
    'homeoffice',
    'bewerbung',
    'dienstreise',
  ]),
  section('St-VA', null, [
    'versicherung',
    'krankenkasse',
    'haftpflicht',
    'riester',
    'rürup',
    'berufsunfähigkeit',
  ]),
  section('St-SA', 'donations', ['kirchensteuer', 'spende', 'kirche', 'studium', 'ausbildung']),
  section('St-AB', null, [
    'arzt',
    'ärzt',
    'apotheke',
    'zahnarzt',
    'krankheit',
    'medikament',
    'brille',
    'optiker',
    'physiotherap',
    'heilpraktiker',
    'krankenhaus',
    'klinik',
    'pflege',
  ]),
  section('St-HH', 'household', [
    'handwerker',
    'reinigung',
    'putzhilfe',
    'haushaltshilfe',
    'gärtner',
    'garten',
    'hausmeister',
    'schornsteinfeger',
    'winterdienst',
    'wartung',
  ]),
  section('St-KI', 'children', [
    'kita',
    'kindergarten',
    'kinderbetreuung',
    'tagesmutter',
    'hort',
    'schulgeld',
    'babysitter',
  ]),
  section('St-V', 'rental', ['vermietung', 'mieteinnahme', 'mieter', 'hausgeld']),
];

/** The section of `code`; throws for a code that is not in {@link TAX_SECTIONS}. */
export function taxSectionByCode(code: TaxSectionCode): TaxSection {
  const found: TaxSection | undefined = TAX_SECTIONS.find((s: TaxSection) => s.code === code);
  if (found === undefined) throw new Error(`unknown tax section "${code}"`);
  return found;
}

export interface EffectiveTaxSection {
  /** null = not tax-relevant (nothing tagged on the chain, or St-0 reached first). */
  readonly section: TaxSection | null;
  /** true when the section (or the St-0) comes from an ancestor. */
  readonly inherited: boolean;
  /** Category whose tag decided it; null when nothing on the chain is tagged. */
  readonly sourceCategoryId: number | null;
}

/**
 * Own tag, else nearest ancestor with a section or St-0. A parent_id missing from `byId` ends the
 * chain; a cycle throws.
 */
export function effectiveTaxSection(params: {
  readonly category: CategoryRow;
  readonly byId: ReadonlyMap<number, CategoryRow>;
  readonly tags: ReadonlyMap<number, TaxTagCode>;
}): EffectiveTaxSection {
  const seen: Set<number> = new Set<number>();
  let current: CategoryRow | undefined = params.category;
  while (current !== undefined) {
    if (seen.has(current.id)) throw new Error(`category ${current.id} is its own ancestor`);
    seen.add(current.id);
    const tag: TaxTagCode | undefined = params.tags.get(current.id);
    const inherited: boolean = current.id !== params.category.id;
    if (tag === TAX_EXCLUDED_CODE) {
      return { section: null, inherited, sourceCategoryId: current.id };
    }
    if (tag !== undefined) {
      return { section: taxSectionByCode(tag), inherited, sourceCategoryId: current.id };
    }
    current = current.parent_id === null ? undefined : params.byId.get(current.parent_id);
  }
  return { section: null, inherited: false, sourceCategoryId: null };
}

/** Sections enabled by the answers: always-on ones, and those whose answer is true or null. */
export function enabledSections(
  situations: Readonly<Record<TaxSituation, boolean | null>>,
): readonly TaxSection[] {
  return TAX_SECTIONS.filter(
    (s: TaxSection) => s.enabledBy === null || situations[s.enabledBy] !== false,
  );
}

export interface TaxSuggestion {
  readonly category: CategoryRow;
  readonly section: TaxSection;
  readonly keyword: string;
}

/**
 * For every category with nothing tagged on its chain (no section, no St-0): the first enabled section (TAX_SECTIONS order) with a keyword in its lower-cased name.
 */
export function suggestTaxSections(params: {
  readonly categories: readonly CategoryRow[];
  readonly enabled: readonly TaxSection[];
  readonly tags: ReadonlyMap<number, TaxTagCode>;
}): TaxSuggestion[] {
  const byId: Map<number, CategoryRow> = new Map<number, CategoryRow>(
    params.categories.map((c: CategoryRow): [number, CategoryRow] => [c.id, c]),
  );
  const ordered: TaxSection[] = TAX_SECTIONS.filter((s: TaxSection) => params.enabled.includes(s));
  const suggestions: TaxSuggestion[] = [];
  for (const category of params.categories) {
    if (params.tags.has(category.id)) continue;
    if (effectiveTaxSection({ category, byId, tags: params.tags }).sourceCategoryId !== null) {
      continue;
    }
    const name: string = category.name.toLowerCase();
    for (const s of ordered) {
      const keyword: string | undefined = s.keywords.find((k: string) => name.includes(k));
      if (keyword !== undefined) {
        suggestions.push({ category, section: s, keyword });
        break;
      }
    }
  }
  return suggestions;
}
