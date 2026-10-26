import { DICTIONARIES, type TranslationKey } from '../models/translation.model';
import type { TranslationService } from '../services/translation.service';
import type { TaxSection } from './tax-sections';

/** The parts of a section's guidance (`tax.sections.<id>.guidance.<part>`). */
export type TaxGuidancePart = 'belongs' | 'excludes' | 'receipts' | 'note';

/**
 * Narrows a key built at runtime (`TAX_SECTIONS` holds plain strings) to a `TranslationKey`, and
 * throws when the dictionary has no such key, so a typo in `tax-sections.ts` fails loudly.
 */
export function taxKey(key: string): TranslationKey {
  if (!Object.hasOwn(DICTIONARIES.en, key)) throw new Error(`unknown translation key "${key}"`);
  return key as TranslationKey;
}

/** `tax.sections.<id>.guidance.<part>` of `section`. */
export function guidanceKey(section: TaxSection, part: TaxGuidancePart): TranslationKey {
  return taxKey(`${section.guidanceKey}.${part}`);
}

/** What a tax choice means, as shown in the picker's tooltip and the section dialog. */
export interface TaxDescription {
  /** What belongs there, or the plain meaning of a non-section choice. */
  readonly text: string;
  /** What looks like it belongs but does not; `null` for a non-section choice. */
  readonly excludes: string | null;
  /** The form the section is filed on; `null` for a non-section choice. */
  readonly form: string | null;
}

/** The explanation of a section: what belongs, what does not, and its form. */
export function taxSectionDescription(
  i18n: TranslationService,
  section: TaxSection,
): TaxDescription {
  return {
    text: i18n.t(guidanceKey(section, 'belongs')),
    excludes: i18n.t(guidanceKey(section, 'excludes')),
    form: i18n.t(taxKey(section.formKey)),
  };
}

/** The explanation of a choice that is not a section ("none", "same as parent", "St-0"). */
export function taxPlainDescription(text: string): TaxDescription {
  return { text, excludes: null, form: null };
}
