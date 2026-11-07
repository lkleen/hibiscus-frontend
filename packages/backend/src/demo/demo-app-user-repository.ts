import type { UserDatabaseSettings } from '@hibiscus-frontend/shared/contracts/user';
import type {
  AppUserDatabaseRecord,
  AppUserDatabaseWrite,
  AppUserKeyRecord,
  AppUserKeyUpdate,
  AppUserRepository,
} from '../repositories/app-user';
import { DuplicateKeyError } from '../repositories/repository-errors';
import { compareText } from './demo-store';
import type { DemoAppUser, DemoStore } from './demo-store';

/** The unique key `uq_hf_app_user_database`: host (case-insensitively), port and name. */
function sameDatabase(a: UserDatabaseSettings, b: UserDatabaseSettings): boolean {
  return a.host.toLowerCase() === b.host.toLowerCase() && a.port === b.port && a.name === b.name;
}

/** `hf_app_user` of the demo data: one record per username. */
export class DemoAppUserRepository implements AppUserRepository {
  constructor(private readonly store: DemoStore) {}

  /** The user's record, created empty when missing (MySQL's `INSERT IGNORE`). */
  private ensureUser(username: string): DemoAppUser {
    const existing: DemoAppUser | undefined = this.store.appUsers.get(username);
    if (existing !== undefined) return existing;
    const created: DemoAppUser = { database: null, key: null };
    this.store.appUsers.set(username, created);
    return created;
  }

  async getDatabase(username: string): Promise<AppUserDatabaseRecord | null> {
    return this.store.appUsers.get(username)?.database ?? null;
  }

  /** Whether another user has the same database; synchronous, so a caller can write right after. */
  private usedByOther(username: string, settings: UserDatabaseSettings): boolean {
    for (const [other, user] of this.store.appUsers) {
      if (other !== username && user.database !== null) {
        if (sameDatabase(user.database.settings, settings)) return true;
      }
    }
    return false;
  }

  async isDatabaseUsedByOther(username: string, settings: UserDatabaseSettings): Promise<boolean> {
    return this.usedByOther(username, settings);
  }

  /** Throws `DuplicateKeyError` before writing anything when another user has the database. */
  async saveDatabase(write: AppUserDatabaseWrite): Promise<void> {
    if (this.usedByOther(write.username, write.settings)) {
      throw new DuplicateKeyError(`The database of ${write.username}`);
    }
    const user: DemoAppUser = this.ensureUser(write.username);
    user.database = {
      settings: { ...write.settings },
      password: write.password,
      version: (user.database?.version ?? 0) + 1,
    };
  }

  async listUsersWithDatabase(): Promise<string[]> {
    return listDemoUsersWithDatabase(this.store);
  }

  async getKey(username: string): Promise<AppUserKeyRecord | null> {
    return this.store.appUsers.get(username)?.key ?? null;
  }

  async createKey(username: string, record: AppUserKeyRecord): Promise<boolean> {
    const user: DemoAppUser = this.ensureUser(username);
    if (user.key !== null) return false;
    user.key = record;
    return true;
  }

  async updateKey(username: string, update: AppUserKeyUpdate): Promise<void> {
    const key: AppUserKeyRecord | null = this.store.appUsers.get(username)?.key ?? null;
    if (key === null || !key.check.equals(update.expectedCheck)) {
      throw new Error(`The key of ${username} changed while it was being updated`);
    }
    this.ensureUser(username).key = update.next;
  }

  async deleteKey(username: string): Promise<void> {
    const user: DemoAppUser | undefined = this.store.appUsers.get(username);
    if (user !== undefined) user.key = null;
  }
}

/** Every user with a database set up, ordered by username. */
export function listDemoUsersWithDatabase(store: DemoStore): string[] {
  return [...store.appUsers]
    .filter(([, user]: [string, DemoAppUser]) => user.database !== null)
    .map(([username]: [string, DemoAppUser]) => username)
    .sort(compareText);
}
