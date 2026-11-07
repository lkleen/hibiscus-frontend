import type { MergeResult } from '../sync/fetched-booking';
import type { SyncDatabase, SyncLock } from '../sync/sync-database';

/** Bank sync needs a real Hibiscus database; with demo data only the lock works. */
export const DEMO_SYNC_UNAVAILABLE_MESSAGE = 'Bank sync is not available with demo data';

/**
 * `SyncDatabase` for demo data. `lock` is an in-process per-connection mutex (deleting a
 * connection takes it); fetching and merging statements throw.
 */
export class DemoSyncDatabase implements SyncDatabase {
  private readonly held: Set<number> = new Set<number>();

  async lock(connectionId: number): Promise<SyncLock | null> {
    if (this.held.has(connectionId)) return null;
    this.held.add(connectionId);
    let released = false;
    return {
      connectionId,
      release: async (): Promise<void> => {
        if (released) throw new Error(`The lock of connection ${connectionId} is released already`);
        released = true;
        this.held.delete(connectionId);
      },
    };
  }

  async latestBookedDate(): Promise<string | null> {
    throw new Error(DEMO_SYNC_UNAVAILABLE_MESSAGE);
  }

  async mergeInTransaction(): Promise<MergeResult> {
    throw new Error(DEMO_SYNC_UNAVAILABLE_MESSAGE);
  }
}
