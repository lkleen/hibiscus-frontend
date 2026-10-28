import { HttpErrorResponse } from '@angular/common/http';
import type {
  TaxSection,
  TaxSectionCode,
  TaxSectionError,
} from '@hibiscus-frontend/shared/contracts/tax-tags';

/** A section code: 1 to 16 letters, digits or hyphens (the server checks the same). */
export const TAX_SECTION_CODE_PATTERN = /^[A-Za-z0-9-]{1,16}$/;
export const TAX_SECTION_CODE_MAX_LENGTH = 16;
/** Built in ("not tax-relevant"); never a user-maintained section. */
const RESERVED_CODE: TaxSectionCode = 'St-0';

/** The form of the open row: every field as the text the user edits. */
export interface TaxSectionDraft {
  readonly code: string;
  readonly name: string;
  readonly form: string;
  readonly belongs: string;
  readonly excludes: string;
  readonly receipts: string;
  readonly note: string;
}

export type TaxSectionDraftField = keyof TaxSectionDraft;

/** The guidance textareas, in the order the form shows them. */
export const GUIDANCE_FIELDS: readonly TaxSectionDraftField[] = [
  'belongs',
  'excludes',
  'receipts',
  'note',
];

export const EMPTY_DRAFT: TaxSectionDraft = {
  code: '',
  name: '',
  form: '',
  belongs: '',
  excludes: '',
  receipts: '',
  note: '',
};

export type TaxSectionCodeProblem = 'required' | 'pattern' | 'reserved' | 'duplicate';

/** What went wrong with the open row's last request. */
export type TaxSectionRowError = TaxSectionError['error'] | 'generic';

export function draftOf(section: TaxSection): TaxSectionDraft {
  return {
    code: section.code,
    name: section.name,
    form: section.form ?? '',
    belongs: section.belongs ?? '',
    excludes: section.excludes ?? '',
    receipts: section.receipts ?? '',
    note: section.note ?? '',
  };
}

/** An optional text is stored as NULL when empty. */
function nullIfEmpty(value: string): string | null {
  return value.trim() === '' ? null : value;
}

/** The section a draft saves as; an untouched draft reproduces the section it came from. */
export function sectionOf(draft: TaxSectionDraft): TaxSection {
  return {
    code: draft.code.trim(),
    name: draft.name.trim(),
    form: nullIfEmpty(draft.form),
    belongs: nullIfEmpty(draft.belongs),
    excludes: nullIfEmpty(draft.excludes),
    receipts: nullIfEmpty(draft.receipts),
    note: nullIfEmpty(draft.note),
  };
}

export function sameSection(a: TaxSection, b: TaxSection): boolean {
  return (Object.keys(a) as (keyof TaxSection)[]).every(
    (key: keyof TaxSection): boolean => a[key] === b[key],
  );
}

/** `takenCodes`: the codes of every other section. */
export function codeProblem(
  code: TaxSectionCode,
  takenCodes: ReadonlySet<TaxSectionCode>,
): TaxSectionCodeProblem | null {
  if (code === '') return 'required';
  if (!TAX_SECTION_CODE_PATTERN.test(code)) return 'pattern';
  if (code === RESERVED_CODE) return 'reserved';
  return takenCodes.has(code) ? 'duplicate' : null;
}

export function toTaxSectionRowError(cause: unknown): TaxSectionRowError {
  if (!(cause instanceof HttpErrorResponse) || cause.status !== 409) return 'generic';
  const body: Partial<TaxSectionError> | null = cause.error as Partial<TaxSectionError> | null;
  const kind: string | undefined = body?.error;
  return kind === 'conflict' || kind === 'in-use' || kind === 'duplicate' ? kind : 'generic';
}
