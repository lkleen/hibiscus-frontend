import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('../repositories/bank-connection', () => ({ listDueBankConnectionIds: vi.fn() }));

import { listDueBankConnectionIds } from '../repositories/bank-connection';
import { SyncScheduler } from './scheduler';
import { ConflictError } from './sync-service';
import type { SyncService } from './sync-service';

let runSync: Mock<SyncService['runSync']>;
let scheduler: SyncScheduler;

beforeEach(() => {
  vi.resetAllMocks();
  runSync = vi.fn<SyncService['runSync']>().mockResolvedValue(undefined);
  scheduler = new SyncScheduler({ runSync }, 60_000);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  scheduler.stop();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('SyncScheduler.tick', () => {
  it('runs the due connections one after the other as scheduled runs', async () => {
    vi.mocked(listDueBankConnectionIds).mockResolvedValue([1, 2]);
    const order: string[] = [];
    runSync.mockImplementation(async (id: number) => {
      order.push(`start ${id}`);
      await Promise.resolve();
      order.push(`end ${id}`);
    });

    await scheduler.tick();

    expect(runSync.mock.calls).toEqual([
      [1, 'scheduled'],
      [2, 'scheduled'],
    ]);
    expect(order).toEqual(['start 1', 'end 1', 'start 2', 'end 2']);
  });

  it('never runs two ticks at once', async () => {
    vi.mocked(listDueBankConnectionIds).mockResolvedValue([1]);
    let release: () => void = (): void => undefined;
    runSync.mockReturnValueOnce(
      new Promise<void>((resolve: () => void) => {
        release = resolve;
      }),
    );

    const first: Promise<void> = scheduler.tick();
    await vi.waitFor(() => expect(runSync).toHaveBeenCalledTimes(1));
    await scheduler.tick();
    release();
    await first;

    expect(runSync).toHaveBeenCalledTimes(1);
    expect(listDueBankConnectionIds).toHaveBeenCalledTimes(1);
  });

  it('logs a failed run and goes on with the next connection', async () => {
    vi.mocked(listDueBankConnectionIds).mockResolvedValue([1, 2]);
    runSync.mockRejectedValueOnce(new Error('bank down'));

    await scheduler.tick();

    expect(runSync).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith(
      '[hibiscus-backend] Scheduled sync of connection 1 failed:',
      expect.any(Error),
    );
  });

  it('skips a locked connection without an error', async () => {
    vi.mocked(listDueBankConnectionIds).mockResolvedValue([1]);
    runSync.mockRejectedValueOnce(new ConflictError(1));

    await scheduler.tick();

    expect(console.error).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalled();
  });

  it('logs a failed due-list query and keeps ticking', async () => {
    vi.mocked(listDueBankConnectionIds).mockRejectedValueOnce(new Error('db down'));

    await scheduler.tick();
    vi.mocked(listDueBankConnectionIds).mockResolvedValueOnce([]);
    await scheduler.tick();

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(listDueBankConnectionIds).toHaveBeenCalledTimes(2);
  });

  it('starts no further connection after stop', async () => {
    vi.mocked(listDueBankConnectionIds).mockResolvedValue([1, 2]);
    runSync.mockImplementationOnce(async () => scheduler.stop());

    await scheduler.tick();

    expect(runSync).toHaveBeenCalledTimes(1);
  });
});

describe('SyncScheduler timer', () => {
  it('ticks every interval with an unref timer until stopped', async () => {
    vi.useFakeTimers();
    vi.mocked(listDueBankConnectionIds).mockResolvedValue([]);

    scheduler.start();
    expect(() => scheduler.start()).toThrow('already running');
    await vi.advanceTimersByTimeAsync(120_000);
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(listDueBankConnectionIds).toHaveBeenCalledTimes(2);
  });
});
