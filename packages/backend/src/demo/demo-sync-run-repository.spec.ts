import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SyncRun } from '@hibiscus-frontend/shared/contracts/sync';
import { DemoBankConnectionRepository } from './demo-bank-connection-repository';
import { createDemoStore } from './demo-store';
import type { DemoStore } from './demo-store';
import { DemoSyncRunRepository } from './demo-sync-run-repository';
import { createTestDataset } from './demo-test-dataset.fixture';

describe('DemoSyncRunRepository', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('records runs and lists the newest per connection', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 7, 8, 30, 0));
    const store: DemoStore = createDemoStore(createTestDataset());
    const connections: DemoBankConnectionRepository = new DemoBankConnectionRepository(store);
    const runs: DemoSyncRunRepository = new DemoSyncRunRepository(store);
    const connectionId: number = await connections.create({
      settings: {
        name: 'Bank',
        blz: '12030000',
        fintsUrl: 'https://fints.example/',
        loginName: 'tobias',
        customerId: null,
        tanMethod: null,
        tanMedia: null,
        syncIntervalHours: 6,
        enabled: true,
      },
      pin: { ciphertext: Buffer.from('p'), iv: Buffer.alloc(12), tag: Buffer.alloc(16) },
    });
    const first: number = await runs.create(connectionId, 'scheduled');
    const second: number = await runs.create(connectionId, 'manual');
    await runs.setWaiting(second, true);
    await runs.finish(first, { status: 'success', error: null, inserted: 3, deleted: 1 });
    await runs.setWaiting(first, true);
    const latest: Map<number, SyncRun> = await runs.listLatest();
    expect(latest.get(connectionId)).toEqual({
      id: second,
      trigger: 'manual',
      startedAt: '2026-11-07 08:30:00',
      finishedAt: null,
      status: 'tan_required',
      error: null,
      inserted: 0,
      deleted: 0,
    });
    expect(store.syncRuns.get(first)).toMatchObject({ status: 'success', inserted: 3 });
    await expect(runs.create(99, 'manual')).rejects.toThrow(/does not exist/);
  });
});
