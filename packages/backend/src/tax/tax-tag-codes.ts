import type { TaxTagCode } from '@hibiscus-frontend/shared/contracts/tax-tags';

/** Every `TaxTagCode`; the compile-time check below fails if the contract gains a code. */
export const TAX_TAG_CODES = [
  'St-WK',
  'St-VA',
  'St-SA',
  'St-AB',
  'St-HH',
  'St-KI',
  'St-V',
  'St-0',
] as const satisfies readonly TaxTagCode[];

type MissingTaxTagCode = Exclude<TaxTagCode, (typeof TAX_TAG_CODES)[number]>;
// Compiles only while MissingTaxTagCode is `never`.
export const TAX_TAG_CODES_COMPLETE: [MissingTaxTagCode] extends [never] ? true : never = true;
