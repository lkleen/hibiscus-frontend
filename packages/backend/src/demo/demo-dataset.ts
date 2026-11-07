import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import type { TaxTag } from '@hibiscus-frontend/shared/contracts/tax-tags';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';

/** The demo data the demo repositories start from, as stored in the gzipped JSON file. */
export interface DemoDataset {
  /** Last day with data, YYYY-MM-DD. */
  readonly generatedAt: string;
  readonly accounts: AccountRow[];
  readonly categories: CategoryRow[];
  readonly transactions: TransactionRow[];
  readonly taxTags: TaxTag[];
}

export const DEMO_DATA_FILE_NAME = 'demo-data.json.gz';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ARRAY_KEYS: readonly (keyof DemoDataset)[] = [
  'accounts',
  'categories',
  'transactions',
  'taxTags',
];

/**
 * The fixed place of the data file, next to `dist` like `public/`:
 * `packages/backend/demo-data/demo-data.json.gz` in the repo, `app/demo-data/…` in a release.
 */
export function demoDataFilePath(): string {
  return join(__dirname, '..', '..', 'demo-data', DEMO_DATA_FILE_NAME);
}

/** Throws unless `value` has the shape of a `DemoDataset` (the rows themselves are trusted). */
function assertDemoDataset(value: unknown, path: string): asserts value is DemoDataset {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Demo data ${path} is not a JSON object`);
  }
  const record: Record<string, unknown> = value as Record<string, unknown>;
  const generatedAt: unknown = record['generatedAt'];
  if (typeof generatedAt !== 'string' || !DATE_PATTERN.test(generatedAt)) {
    throw new Error(`Demo data ${path} has no generatedAt date (YYYY-MM-DD)`);
  }
  for (const key of ARRAY_KEYS) {
    if (!Array.isArray(record[key])) throw new Error(`Demo data ${path} has no ${key} array`);
  }
}

/** Reads, gunzips and parses the demo data file; throws on anything invalid. */
export function loadDemoDataset(path: string): DemoDataset {
  const json: string = gunzipSync(readFileSync(path)).toString('utf8');
  const parsed: unknown = JSON.parse(json);
  assertDemoDataset(parsed, path);
  return parsed;
}

/** The file content for `dataset`; used by the demo data generator. */
export function encodeDemoDataset(dataset: DemoDataset): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(dataset), 'utf8'));
}
