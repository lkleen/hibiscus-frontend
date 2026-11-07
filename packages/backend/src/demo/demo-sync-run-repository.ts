import type { SyncRun, SyncTrigger } from '@hibiscus-frontend/shared/contracts/sync';
import type { SyncRunRepository, SyncRunResult } from '../repositories/sync-run';
import { formatTimestamp, nextId } from './demo-store';
import type { DemoStore, DemoSyncRunRow } from './demo-store';

function toSyncRun(row: DemoSyncRunRow): SyncRun {
  return {
    id: row.id,
    trigger: row.trigger,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    status: row.status,
    error: row.error,
    inserted: row.inserted,
    deleted: row.deleted,
  };
}

/** `hf_sync_run` of the demo data; runs are removed with their connection. */
export class DemoSyncRunRepository implements SyncRunRepository {
  constructor(private readonly store: DemoStore) {}

  async create(connectionId: number, trigger: SyncTrigger): Promise<number> {
    // `fk_hf_sync_run_connection`: MySQL refuses a run of an unknown connection.
    if (!this.store.bankConnections.has(connectionId)) {
      throw new Error(`Bank connection ${connectionId} does not exist`);
    }
    const id: number = nextId(this.store.syncRuns.keys());
    this.store.syncRuns.set(id, {
      id,
      connectionId,
      trigger,
      startedAt: formatTimestamp(new Date()),
      finishedAt: null,
      status: 'running',
      error: null,
      inserted: 0,
      deleted: 0,
    });
    return id;
  }

  async setWaiting(id: number, waiting: boolean): Promise<void> {
    const row: DemoSyncRunRow | undefined = this.store.syncRuns.get(id);
    if (row === undefined || row.finishedAt !== null) return;
    this.store.syncRuns.set(id, { ...row, status: waiting ? 'tan_required' : 'running' });
  }

  async finish(id: number, result: SyncRunResult): Promise<void> {
    const row: DemoSyncRunRow | undefined = this.store.syncRuns.get(id);
    // Like the MySQL `UPDATE … WHERE id = ?`, an unknown id changes nothing.
    if (row === undefined) return;
    this.store.syncRuns.set(id, {
      ...row,
      finishedAt: formatTimestamp(new Date()),
      status: result.status,
      error: result.error,
      inserted: result.inserted,
      deleted: result.deleted,
    });
  }

  async listLatest(): Promise<Map<number, SyncRun>> {
    const latest: Map<number, DemoSyncRunRow> = new Map<number, DemoSyncRunRow>();
    for (const row of this.store.syncRuns.values()) {
      const current: DemoSyncRunRow | undefined = latest.get(row.connectionId);
      if (current === undefined || row.id > current.id) latest.set(row.connectionId, row);
    }
    return new Map<number, SyncRun>(
      [...latest].map(([connectionId, row]: [number, DemoSyncRunRow]): [number, SyncRun] => [
        connectionId,
        toSyncRun(row),
      ]),
    );
  }
}
