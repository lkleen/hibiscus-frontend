import { describe, expect, it } from 'vitest';
import type { SyncLock } from '../sync/sync-database';
import { DEMO_SYNC_UNAVAILABLE_MESSAGE, DemoSyncDatabase } from './demo-sync-database';

describe('DemoSyncDatabase', () => {
  it('holds one lock per connection until it is released', async () => {
    const database: DemoSyncDatabase = new DemoSyncDatabase();
    const lock: SyncLock | null = await database.lock(1);
    if (lock === null) throw new Error('lock not taken');
    expect(await database.lock(1)).toBeNull();
    expect(await database.lock(2)).not.toBeNull();
    await lock.release();
    await expect(lock.release()).rejects.toThrow(/released already/);
    expect(await database.lock(1)).not.toBeNull();
  });

  it('refuses to fetch or merge statements', async () => {
    const database: DemoSyncDatabase = new DemoSyncDatabase();
    const lock: SyncLock | null = await database.lock(1);
    if (lock === null) throw new Error('lock not taken');
    await expect(database.latestBookedDate()).rejects.toThrow(DEMO_SYNC_UNAVAILABLE_MESSAGE);
    await expect(database.mergeInTransaction()).rejects.toThrow(DEMO_SYNC_UNAVAILABLE_MESSAGE);
  });
});
