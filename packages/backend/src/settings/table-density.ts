import { z } from 'zod';
import type { TableDensity } from '@hibiscus-frontend/shared/contracts/user-settings';

export const TABLE_DENSITY_SETTING_KEY = 'table-density';

/** Every `TableDensity` id; the compile-time check below fails if the contract gains an id. */
export const TABLE_DENSITIES = [
  'extra-compact',
  'compact',
  'normal',
  'comfortable',
  'spacious',
] as const satisfies readonly TableDensity[];

type MissingTableDensity = Exclude<TableDensity, (typeof TABLE_DENSITIES)[number]>;
// Compiles only while MissingTableDensity is `never`.
export const TABLE_DENSITIES_COMPLETE: [MissingTableDensity] extends [never] ? true : never = true;

/** Density used until the user picks one. */
export const DEFAULT_TABLE_DENSITY: TableDensity = 'normal';

export const TableDensitySchema: z.ZodType<TableDensity> = z.enum(TABLE_DENSITIES);
