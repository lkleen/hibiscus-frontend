import type { UserDatabaseHandle } from '../db/pool';
import type { UserDatabaseLookup, UserDatabases } from '../db/user-databases';
import { listDemoUsersWithDatabase } from './demo-app-user-repository';
import type { DemoStore } from './demo-store';

/**
 * The one in-memory database every user works on with demo data. It has no pool; its settings
 * only name it (e.g. for the sync lock names).
 */
export const DEMO_DATABASE: UserDatabaseHandle = {
  pool: null,
  settings: { host: 'demo', port: 0, name: 'demo', user: 'demo' },
};

/** `UserDatabases` for demo data: every user is configured, on the same in-memory database. */
export class DemoUserDatabases implements UserDatabases {
  constructor(private readonly store: DemoStore) {}

  async acquire(): Promise<UserDatabaseLookup> {
    return { status: 'configured', database: DEMO_DATABASE };
  }

  async databaseStatus(): Promise<'configured' | 'unconfigured'> {
    return 'configured';
  }

  async listUsersWithDatabase(): Promise<string[]> {
    return listDemoUsersWithDatabase(this.store);
  }

  invalidate(): void {
    // Nothing is cached: the demo database is fixed and never replaced.
  }
}
