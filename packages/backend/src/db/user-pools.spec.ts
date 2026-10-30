import { randomBytes } from 'node:crypto';
import type { Pool } from 'mysql2/promise';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { UserDatabaseSettings } from '@hibiscus-frontend/shared/contracts/user';

vi.mock('./pool', async (importOriginal: () => Promise<typeof import('./pool')>) => ({
  ...(await importOriginal()),
  createUserDatabasePool: vi.fn(),
}));
vi.mock('../repositories/app-user', () => ({
  getAppUserDatabase: vi.fn(),
  listAppUsersWithDatabase: vi.fn(),
}));
vi.mock('../repositories/user-setting', () => ({ ensureUserSettingTable: vi.fn() }));
vi.mock('../repositories/tax-tag', () => ({ ensureTaxTagTables: vi.fn() }));
vi.mock('../sync/sync-tables', () => ({ ensureSyncTables: vi.fn() }));

import { getAppUserDatabase } from '../repositories/app-user';
import type { AppUserDatabaseRecord } from '../repositories/app-user';
import { ensureTaxTagTables } from '../repositories/tax-tag';
import { ensureUserSettingTable } from '../repositories/user-setting';
import { CredentialCrypto } from '../sync/credential-crypto';
import { ensureSyncTables } from '../sync/sync-tables';
import { createUserDatabasePool, currentUser, getPool } from './pool';
import type { DatabaseTarget } from './pool';
import { UserPools } from './user-pools';
import type { UserDatabaseLookup } from './user-pools';

interface FakePool {
  readonly id: number;
  readonly end: Mock<() => Promise<void>>;
}

const crypto: CredentialCrypto = new CredentialCrypto(randomBytes(32));
let records: Map<string, AppUserDatabaseRecord>;
let created: FakePool[];
let pools: UserPools;

function settingsOf(user: string, host = 'hibiscus-db'): UserDatabaseSettings {
  return { host, port: 3306, name: user, user };
}

function store(user: string, params: { version: number; host?: string }): void {
  records.set(user, {
    settings: settingsOf(user, params.host),
    password: crypto.encrypt(`pw-${user}-${params.version}`),
    version: params.version,
  });
}

async function poolOf(user: string): Promise<Pool> {
  const lookup: UserDatabaseLookup = await pools.acquire(user);
  if (lookup.status !== 'configured') throw new Error(`${user} is ${lookup.status}`);
  return lookup.database.pool;
}

beforeEach(() => {
  vi.resetAllMocks();
  records = new Map<string, AppUserDatabaseRecord>();
  created = [];
  vi.mocked(getAppUserDatabase).mockImplementation(
    async (user: string) => records.get(user) ?? null,
  );
  vi.mocked(createUserDatabasePool).mockImplementation((): Pool => {
    const pool: FakePool = { id: created.length + 1, end: vi.fn().mockResolvedValue(undefined) };
    created.push(pool);
    return pool as unknown as Pool;
  });
  pools = new UserPools({ crypto, allowedHosts: [{ host: 'hibiscus-db', port: null }] });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('UserPools.acquire', () => {
  it('gives two users two different pools on their own databases', async () => {
    store('alice', { version: 1 });
    store('bob', { version: 1 });

    const alice: Pool = await poolOf('alice');
    const bob: Pool = await poolOf('bob');

    expect(alice).not.toBe(bob);
    expect(await poolOf('alice')).toBe(alice);
    const targets: DatabaseTarget[] = vi
      .mocked(createUserDatabasePool)
      .mock.calls.map((call: [DatabaseTarget]) => call[0]);
    expect(targets).toEqual([
      { ...settingsOf('alice'), password: 'pw-alice-1' },
      { ...settingsOf('bob'), password: 'pw-bob-1' },
    ]);
  });

  it('creates one pool and ensures the tables once under concurrent first requests', async () => {
    store('alice', { version: 1 });
    let release: () => void = (): void => undefined;
    vi.mocked(ensureUserSettingTable).mockReturnValue(
      new Promise<void>((resolve: () => void) => {
        release = resolve;
      }),
    );

    const lookups: Promise<Pool>[] = [poolOf('alice'), poolOf('alice'), poolOf('alice')];
    await vi.waitFor(() => expect(ensureUserSettingTable).toHaveBeenCalled());
    release();
    const result: Pool[] = await Promise.all(lookups);

    expect(new Set(result).size).toBe(1);
    expect(createUserDatabasePool).toHaveBeenCalledTimes(1);
    expect(ensureUserSettingTable).toHaveBeenCalledTimes(1);
    expect(ensureTaxTagTables).toHaveBeenCalledTimes(1);
    expect(ensureSyncTables).toHaveBeenCalledTimes(1);
  });

  it('ensures the tables inside the user’s context, on the user’s pool', async () => {
    store('alice', { version: 1 });
    const seen: string[] = [];
    vi.mocked(ensureSyncTables).mockImplementation(async () => {
      seen.push(`${currentUser().user}:${(getPool() as unknown as FakePool).id}`);
    });

    await poolOf('alice');

    expect(seen).toEqual(['alice:1']);
  });

  it('retries the table setup on the next request after it failed', async () => {
    store('alice', { version: 1 });
    vi.mocked(ensureTaxTagTables).mockRejectedValueOnce(new Error('ddl failed'));

    await expect(pools.acquire('alice')).rejects.toThrow('ddl failed');
    await poolOf('alice');

    expect(ensureTaxTagTables).toHaveBeenCalledTimes(2);
    expect(createUserDatabasePool).toHaveBeenCalledTimes(1);
  });

  it('replaces the pool when the settings version rises, and ends the old one', async () => {
    store('alice', { version: 1 });
    const first: Pool = await poolOf('alice');
    store('alice', { version: 2 });

    const second: Pool = await poolOf('alice');

    expect(second).not.toBe(first);
    expect(created[0]?.end).toHaveBeenCalledOnce();
    expect(vi.mocked(createUserDatabasePool).mock.calls[1]?.[0].password).toBe('pw-alice-2');
  });

  it('keeps the newer pool when a request read an older row', async () => {
    store('alice', { version: 2 });
    const newer: Pool = await poolOf('alice');
    store('alice', { version: 1 });

    expect(await poolOf('alice')).toBe(newer);
    expect(created[0]?.end).not.toHaveBeenCalled();
  });

  it('ends and drops the pool on invalidate', async () => {
    store('alice', { version: 1 });
    const first: Pool = await poolOf('alice');

    pools.invalidate('alice');

    expect(created[0]?.end).toHaveBeenCalledOnce();
    expect(await poolOf('alice')).not.toBe(first);
  });

  it('reports a user without a database as unconfigured', async () => {
    expect(await pools.acquire('carol')).toEqual({ status: 'unconfigured' });
    expect(await pools.databaseStatus('carol')).toBe('unconfigured');
  });

  it('re-checks the allowlist and creates no pool for a host that left it', async () => {
    store('alice', { version: 1, host: 'old-db' });

    expect(await pools.acquire('alice')).toEqual({ status: 'host-not-allowed' });
    expect(await pools.databaseStatus('alice')).toBe('unconfigured');
    expect(createUserDatabasePool).not.toHaveBeenCalled();
  });

  it('drops a cached pool once its host is not allowed any more', async () => {
    store('alice', { version: 1 });
    await poolOf('alice');
    store('alice', { version: 1, host: 'old-db' });

    expect(await pools.acquire('alice')).toEqual({ status: 'host-not-allowed' });
    expect(created[0]?.end).toHaveBeenCalledOnce();
  });

  it('reports a configured user without opening a pool', async () => {
    store('alice', { version: 1 });

    expect(await pools.databaseStatus('alice')).toBe('configured');
    expect(createUserDatabasePool).not.toHaveBeenCalled();
  });
});
