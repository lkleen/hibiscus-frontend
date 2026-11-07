import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import type {
  BankConnectionAccount,
  BankConnectionSettings,
  SyncPausedReason,
  SyncRun,
  SyncRunStatus,
} from '@hibiscus-frontend/shared/contracts/sync';
import type {
  TaxSection,
  TaxSectionCode,
  TaxTagCode,
} from '@hibiscus-frontend/shared/contracts/tax-tags';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import type { AppUserDatabaseRecord, AppUserKeyRecord } from '../repositories/app-user';
import type { EncryptedSecret } from '../sync/credential-crypto';
import { DEFAULT_TAX_SECTIONS, TAX_NOT_RELEVANT_SECTION } from '../tax/tax-section-defaults';
import type { DemoDataset } from './demo-dataset';

/** One `hf_app_user` row: a user's database settings and key, each `null` while not set. */
export interface DemoAppUser {
  database: AppUserDatabaseRecord | null;
  key: AppUserKeyRecord | null;
}

/** One `hf_bank_connection` row. */
export interface DemoBankConnectionRow {
  readonly id: number;
  readonly settings: BankConnectionSettings;
  readonly pin: EncryptedSecret | null;
  readonly bankingInformation: string | null;
  readonly pausedReason: SyncPausedReason | null;
  readonly lastSyncAt: string | null;
  readonly lastStatus: SyncRunStatus | null;
  readonly lastError: string | null;
}

/** One `hf_bank_connection_account` row. */
export interface DemoBankConnectionAccountRow extends BankConnectionAccount {
  readonly connectionId: number;
}

/** One `hf_sync_run` row. */
export interface DemoSyncRunRow extends SyncRun {
  readonly connectionId: number;
}

/**
 * The in-memory tables of the demo data: one store per process, changes live until it stops. Rows
 * are replaced, never mutated (only a `DemoAppUser` record has its two fields reassigned), so a row
 * handed out by a repository never changes afterwards.
 *
 * The demo repositories keep every check-then-write synchronous (no `await` between reading and
 * writing these tables), so each one is atomic on the event loop.
 */
export interface DemoStore {
  /** `konto`; read-only in the app. */
  readonly accounts: readonly AccountRow[];
  /** `umsatztyp` by id. */
  readonly categories: Map<number, CategoryRow>;
  /** `umsatz` by id, in ascending id order (rows are only ever replaced, never inserted). */
  readonly transactions: Map<number, TransactionRow>;
  /** `hf_tax_section` by code, `St-0` included. */
  readonly taxSections: Map<TaxSectionCode, TaxSection>;
  /** `hf_category_tax_tag`: category id → code. */
  readonly taxTags: Map<number, TaxTagCode>;
  /** `hf_user_setting`: `userSettingKey(user, key)` → the value as JSON. */
  readonly userSettings: Map<string, string>;
  /** `hf_app_user` by username. */
  readonly appUsers: Map<string, DemoAppUser>;
  /** `hf_bank_connection` by id. */
  readonly bankConnections: Map<number, DemoBankConnectionRow>;
  /** `hf_bank_connection_account`. */
  bankConnectionAccounts: DemoBankConnectionAccountRow[];
  /** `hf_sync_run` by id. */
  readonly syncRuns: Map<number, DemoSyncRunRow>;
}

/** Throws unless every foreign key of the dataset points to an existing row. */
function assertReferences(store: DemoStore): void {
  const accountIds: Set<number> = new Set<number>(store.accounts.map((a: AccountRow) => a.id));
  for (const category of store.categories.values()) {
    if (category.parent_id !== null && !store.categories.has(category.parent_id)) {
      throw new Error(`Demo category ${category.id} has an unknown parent ${category.parent_id}`);
    }
    if (category.konto_id !== null && !accountIds.has(category.konto_id)) {
      throw new Error(`Demo category ${category.id} has an unknown account ${category.konto_id}`);
    }
  }
  for (const transaction of store.transactions.values()) {
    if (!accountIds.has(transaction.konto_id)) {
      throw new Error(`Demo transaction ${transaction.id} has an unknown account`);
    }
    if (transaction.umsatztyp_id !== null && !store.categories.has(transaction.umsatztyp_id)) {
      throw new Error(`Demo transaction ${transaction.id} has an unknown category`);
    }
  }
  for (const [categoryId, code] of store.taxTags) {
    if (!store.categories.has(categoryId)) {
      throw new Error(`Demo tax tag of unknown category ${categoryId}`);
    }
    if (!store.taxSections.has(code)) {
      throw new Error(`Demo tax tag of category ${categoryId} has an unknown code ${code}`);
    }
  }
}

/** Builds a map by id; throws on a duplicate id. */
function byId<T extends { readonly id: number }>(
  rows: readonly T[],
  table: string,
): Map<number, T> {
  const map: Map<number, T> = new Map<number, T>();
  for (const row of rows) {
    if (map.has(row.id)) throw new Error(`Demo ${table} id ${row.id} is not unique`);
    map.set(row.id, row);
  }
  return map;
}

/**
 * A fresh store filled from `dataset`, which is deep-copied and never mutated. The tax sections are
 * seeded like a newly created `hf_tax_section`: the defaults plus the built-in `St-0`. Throws when
 * the dataset breaks a foreign key or a unique id.
 */
export function createDemoStore(dataset: DemoDataset): DemoStore {
  const copy: DemoDataset = structuredClone(dataset);
  const transactions: TransactionRow[] = [...copy.transactions].sort(
    (a: TransactionRow, b: TransactionRow): number => a.id - b.id,
  );
  const taxTags: Map<number, TaxTagCode> = new Map<number, TaxTagCode>();
  for (const tag of copy.taxTags) {
    if (taxTags.has(tag.category_id)) {
      throw new Error(`Demo category ${tag.category_id} has more than one tax tag`);
    }
    taxTags.set(tag.category_id, tag.code);
  }
  const store: DemoStore = {
    accounts: [...byId(copy.accounts, 'account').values()],
    categories: byId(copy.categories, 'category'),
    transactions: byId(transactions, 'transaction'),
    taxSections: new Map<TaxSectionCode, TaxSection>(
      [...DEFAULT_TAX_SECTIONS, TAX_NOT_RELEVANT_SECTION].map(
        (section: TaxSection): [TaxSectionCode, TaxSection] => [section.code, { ...section }],
      ),
    ),
    taxTags,
    userSettings: new Map<string, string>(),
    appUsers: new Map<string, DemoAppUser>(),
    bankConnections: new Map<number, DemoBankConnectionRow>(),
    bankConnectionAccounts: [],
    syncRuns: new Map<number, DemoSyncRunRow>(),
  };
  assertReferences(store);
  return store;
}

/** The id an `AUTO_INCREMENT` insert gets here: the highest existing id + 1 (1 when empty). */
export function nextId(ids: Iterable<number>): number {
  let max = 0;
  for (const id of ids) if (id > max) max = id;
  return max + 1;
}

/** SQL's NULL-safe `<=>` for the scalar column values the repositories compare. */
export function sameValue(a: unknown, b: unknown): boolean {
  return (a ?? null) === (b ?? null);
}

/**
 * Text ordering close to MariaDB's default `utf8mb4_general_ci` collation (case- and
 * accent-insensitive) for `ORDER BY` on text columns.
 */
const TEXT_COLLATOR: Intl.Collator = new Intl.Collator('de', { sensitivity: 'base' });

/** `ORDER BY` on a nullable text column: `NULL` first, as MariaDB sorts it ascending. */
export function compareText(a: string | null, b: string | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? -1 : 1;
  return TEXT_COLLATOR.compare(a, b);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** `NOW()` as the pool returns it (`dateStrings`): `YYYY-MM-DD HH:mm:ss` in local time. */
export function formatTimestamp(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

const TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

/** Parses a `formatTimestamp` string as local time; throws on any other format. */
export function parseTimestamp(value: string): Date {
  const match: RegExpExecArray | null = TIMESTAMP_PATTERN.exec(value);
  if (match === null) throw new Error(`Invalid timestamp ${value}`);
  const [year, month, day, hours, minutes, seconds] = match.slice(1).map(Number);
  return new Date(year, month - 1, day, hours, minutes, seconds);
}
