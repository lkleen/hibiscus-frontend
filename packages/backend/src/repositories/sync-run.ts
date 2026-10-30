import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { SyncRun, SyncRunStatus, SyncTrigger } from '@hibiscus-frontend/shared/contracts/sync';
import { getPool } from '../db/pool';

interface SyncRunRow extends RowDataPacket {
  id: number;
  connection_id: number;
  trigger_type: SyncTrigger;
  started_at: string;
  finished_at: string | null;
  status: SyncRunStatus;
  error: string | null;
  inserted: number;
  deleted: number;
}

/** What a finished run records. */
export interface SyncRunResult {
  readonly status: SyncRunStatus;
  readonly error: string | null;
  readonly inserted: number;
  readonly deleted: number;
}

function toSyncRun(row: SyncRunRow): SyncRun {
  return {
    id: row.id,
    trigger: row.trigger_type,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    error: row.error,
    inserted: row.inserted,
    deleted: row.deleted,
  };
}

/** Inserts a `running` run started now and returns its id. */
export async function createSyncRun(connectionId: number, trigger: SyncTrigger): Promise<number> {
  const [result] = await getPool().query<ResultSetHeader>(
    `INSERT INTO hf_sync_run (connection_id, trigger_type, started_at, status)
     VALUES (?, ?, NOW(), 'running')`,
    [connectionId, trigger],
  );
  return result.insertId;
}

/** Switches an unfinished run between `running` and `tan_required`. */
export async function setSyncRunWaiting(id: number, waiting: boolean): Promise<void> {
  await getPool().query('UPDATE hf_sync_run SET status = ? WHERE id = ? AND finished_at IS NULL', [
    waiting ? 'tan_required' : 'running',
    id,
  ]);
}

/** Finishes a run now with its outcome. */
export async function finishSyncRun(id: number, result: SyncRunResult): Promise<void> {
  await getPool().query(
    `UPDATE hf_sync_run SET finished_at = NOW(), status = ?, error = ?, inserted = ?, deleted = ?
     WHERE id = ?`,
    [result.status, result.error, result.inserted, result.deleted, id],
  );
}

/** The newest run of every connection that has one, keyed by connection id. */
export async function listLatestSyncRuns(): Promise<Map<number, SyncRun>> {
  const [rows] = await getPool().query<SyncRunRow[]>(
    `SELECT r.id, r.connection_id, r.trigger_type, r.started_at, r.finished_at, r.status, r.error,
            r.inserted, r.deleted
     FROM hf_sync_run r
     JOIN (SELECT connection_id, MAX(id) AS id FROM hf_sync_run GROUP BY connection_id) latest
       ON latest.id = r.id`,
  );
  return new Map<number, SyncRun>(
    rows.map((row: SyncRunRow): [number, SyncRun] => [row.connection_id, toSyncRun(row)]),
  );
}
