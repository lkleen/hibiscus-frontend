import { z } from 'zod';
import type {
  TableDensities,
  TableDensity,
  TableViewId,
} from '@hibiscus-frontend/shared/contracts/user-settings';

export const TABLE_DENSITIES_SETTING_KEY = 'table-densities';

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

/** Every `TableViewId`; the compile-time check below fails if the contract gains an id. */
export const TABLE_VIEW_IDS = [
  'transactions-list',
  'transactions-by-category',
  'categories',
] as const satisfies readonly TableViewId[];

type MissingTableViewId = Exclude<TableViewId, (typeof TABLE_VIEW_IDS)[number]>;
// Compiles only while MissingTableViewId is `never`.
export const TABLE_VIEW_IDS_COMPLETE: [MissingTableViewId] extends [never] ? true : never = true;

/** No view has a density chosen yet; each missing view is rendered `normal`. */
export const DEFAULT_TABLE_DENSITIES: TableDensities = {};

/** Strict object: unknown view ids are rejected; every view id is optional. */
export const TableDensitiesSchema: z.ZodType<TableDensities> = z
  .object(
    Object.fromEntries(
      TABLE_VIEW_IDS.map((id: TableViewId) => [id, z.enum(TABLE_DENSITIES).optional()]),
    ),
  )
  .strict();
