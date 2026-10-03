import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';

/** A fully populated category row; override only what a test cares about. */
export function categoryRow(overrides: Partial<CategoryRow> = {}): CategoryRow {
  return {
    id: 1,
    name: 'Category',
    nummer: null,
    pattern: null,
    isregex: null,
    umsatztyp: null,
    parent_id: null,
    color: null,
    customcolor: null,
    kommentar: null,
    konto_id: null,
    konto_kategorie: null,
    flags: null,
    ...overrides,
  };
}
