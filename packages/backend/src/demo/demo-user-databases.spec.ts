import { describe, expect, it } from 'vitest';
import type { UserDatabaseLookup, UserDatabases } from '../db/user-databases';
import { DemoAppUserRepository } from './demo-app-user-repository';
import { createDemoStore } from './demo-store';
import type { DemoStore } from './demo-store';
import { createTestDataset } from './demo-test-dataset.fixture';
import { DEMO_DATABASE, DemoUserDatabases } from './demo-user-databases';

describe('DemoUserDatabases', () => {
  it('gives every user the demo database', async () => {
    const store: DemoStore = createDemoStore(createTestDataset());
    const databases: UserDatabases = new DemoUserDatabases(store);
    const lookup: UserDatabaseLookup = await databases.acquire('anyone');
    expect(lookup).toEqual({ status: 'configured', database: DEMO_DATABASE });
    expect(DEMO_DATABASE.pool).toBeNull();
    expect(DEMO_DATABASE.settings.host).toBe('demo');
    expect(await databases.databaseStatus('anyone')).toBe('configured');
    databases.invalidate('anyone');
  });

  it('lists the users with a database record', async () => {
    const store: DemoStore = createDemoStore(createTestDataset());
    const databases: UserDatabases = new DemoUserDatabases(store);
    expect(await databases.listUsersWithDatabase()).toEqual([]);
    await new DemoAppUserRepository(store).saveDatabase({
      username: 'demo',
      settings: DEMO_DATABASE.settings,
      password: { ciphertext: Buffer.from('x'), iv: Buffer.alloc(12), tag: Buffer.alloc(16) },
    });
    expect(await databases.listUsersWithDatabase()).toEqual(['demo']);
  });
});
