import type { Pool } from 'mysql2/promise';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncRun } from '@hibiscus-frontend/shared/contracts/sync';

vi.mock('../db/pool', () => ({ getPool: vi.fn() }));

import { getPool } from '../db/pool';
import { createSyncRun, finishSyncRun, listLatestSyncRuns, setSyncRunWaiting } from './sync-run';

let pool: { query: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.resetAllMocks();
  pool = { query: vi.fn().mockResolvedValue([{ insertId: 41 }]) };
  vi.mocked(getPool).mockReturnValue(pool as unknown as Pool);
});

describe('sync-run repository', () => {
  it('creates a running run', async () => {
    expect(await createSyncRun(3, 'scheduled')).toBe(41);
    expect(pool.query.mock.calls[0]![0]).toContain("VALUES (?, ?, NOW(), 'running')");
    expect(pool.query.mock.calls[0]![1]).toEqual([3, 'scheduled']);
  });

  it('switches only an unfinished run between running and tan_required', async () => {
    await setSyncRunWaiting(41, true);
    await setSyncRunWaiting(41, false);

    expect(pool.query.mock.calls[0]![0]).toContain('finished_at IS NULL');
    expect(pool.query.mock.calls[0]![1]).toEqual(['tan_required', 41]);
    expect(pool.query.mock.calls[1]![1]).toEqual(['running', 41]);
  });

  it('finishes a run with its outcome', async () => {
    await finishSyncRun(41, { status: 'error', error: 'x', inserted: 1, deleted: 2 });

    expect(pool.query.mock.calls[0]![1]).toEqual(['error', 'x', 1, 2, 41]);
  });

  it('keys the newest runs by connection', async () => {
    pool.query.mockResolvedValueOnce([
      [
        {
          id: 41,
          connection_id: 3,
          trigger_type: 'manual',
          started_at: '2026-10-29 08:00:00',
          finished_at: null,
          status: 'running',
          error: null,
          inserted: 0,
          deleted: 0,
        },
      ],
    ]);

    const runs: Map<number, SyncRun> = await listLatestSyncRuns();

    expect(runs.get(3)).toEqual({
      id: 41,
      trigger: 'manual',
      startedAt: '2026-10-29 08:00:00',
      finishedAt: null,
      status: 'running',
      error: null,
      inserted: 0,
      deleted: 0,
    });
  });
});
