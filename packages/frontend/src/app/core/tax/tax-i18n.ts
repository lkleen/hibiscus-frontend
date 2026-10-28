import type { TaxSection } from '@hibiscus-frontend/shared/contracts/tax-tags';

/** What a tax choice means, as shown in the picker's tooltip and the section dialog. */
export interface TaxDescription {
  /** What belongs there, or the plain meaning of a non-section choice. */
  readonly text: string;
  /** What looks like it belongs but does not; `null` for a non-section choice. */
  readonly excludes: string | null;
  /** The form the section is filed on; `null` for a non-section choice. */
  readonly form: string | null;
  /** The receipts to keep; `null` for a non-section choice. */
  readonly receipts: string | null;
  /** Anything else worth knowing; `null` for a non-section choice. */
  readonly note: string | null;
}

/** The explanation of a section, from the texts the user wrote (the name stands in for none). */
export function taxSectionDescription(section: TaxSection): TaxDescription {
  return {
    text: section.belongs ?? section.name,
    excludes: section.excludes,
    form: section.form,
    receipts: section.receipts,
    note: section.note,
  };
}

/** The explanation of a choice that is not a section ("none", "same as parent", "St-0"). */
export function taxPlainDescription(text: string): TaxDescription {
  return { text, excludes: null, form: null, receipts: null, note: null };
}
