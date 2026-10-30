import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('../repositories/bank-connection', () => ({ listDueBankConnectionIds: vi.fn() }));

import type { Pool } from 'mysql2/promise';
import { currentUser } from '../db/pool';
import type { UserContext, UserDatabaseHandle } from '../db/pool';
import type { UserDatabaseLookup } from '../db/user-pools';
import { listDueBankConnectionIds } from '../repositories/bank-connection';
import { SyncScheduler } from './scheduler';
import type { SyncSchedulerDeps } from './scheduler';
import { UserBusyError } from '../db/user-activity';
import { ConflictError } from './sync-service';
import type { SyncService, SyncStartParams } from './sync-service';
import type { UnattendedKeyState } from './user-keys';

let runSync: Mock<SyncService['runSync']>;
let users: {
  listUsersWithDatabase: Mock<SyncSchedulerDeps['users']['listUsersWithDatabase']>;
  acquire: Mock<SyncSchedulerDeps['users']['acquire']>;
};
let keys: {
  unattendedState: Mock<SyncSchedulerDeps['keys']['unattendedState']>;
  resolveUnattended: Mock<SyncSchedulerDeps['keys']['resolveUnattended']>;
};
let scheduler: SyncScheduler;

function calls(): [number, string][] {
  return runSync.mock.calls.map(([params]: [SyncStartParams]): [number, string] => [
    params.connectionId,
    params.trigger,
  ]);
}

function skipLogs(): unknown[][] {
  return vi
    .mocked(console.log)
    .mock.calls.filter((call: unknown[]) => String(call[0]).includes('Scheduled syncs of'));
}

function databaseOf(user: string): UserDatabaseHandle {
  return {
    pool: { user } as unknown as Pool,
    settings: { host: 'hibiscus-db', port: 3306, name: user, user },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  runSync = vi.fn<SyncService['runSync']>().mockResolvedValue(undefined);
  users = {
    listUsersWithDatabase: vi.fn().mockResolvedValue(['alice']),
    acquire: vi.fn(async (user: string): Promise<UserDatabaseLookup> => ({
      status: 'configured',
      database: databaseOf(user),
    })),
  };
  keys = {
    unattendedState: vi.fn().mockResolvedValue('ready'),
    resolveUnattended: vi.fn(async (): Promise<Buffer> => Buffer.alloc(32, 7)),
  };
  scheduler = new SyncScheduler({ service: { runSync }, users, keys }, 60_000);
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
    runSync.mockImplementation(async ({ connectionId }: SyncStartParams) => {
      order.push(`start ${connectionId}`);
      await Promise.resolve();
      order.push(`end ${connectionId}`);
    });

    await scheduler.tick();

    expect(calls()).toEqual([
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

describe('SyncScheduler across users', () => {
  it('runs each user’s due connections in that user’s own context', async () => {
    users.listUsersWithDatabase.mockResolvedValue(['alice', 'bob']);
    vi.mocked(listDueBankConnectionIds).mockImplementation(async () =>
      currentUser().user === 'alice' ? [1] : [1, 2],
    );
    const seen: string[] = [];
    runSync.mockImplementation(async ({ connectionId }: SyncStartParams) => {
      const context: UserContext = currentUser();
      seen.push(`${context.user}:${context.database?.settings.name}:${connectionId}`);
    });

    await scheduler.tick();

    expect(seen).toEqual(['alice:alice:1', 'bob:bob:1', 'bob:bob:2']);
  });

  it('skips a user whose database is not usable and goes on with the next', async () => {
    users.listUsersWithDatabase.mockResolvedValue(['alice', 'bob']);
    users.acquire.mockResolvedValueOnce({ status: 'host-not-allowed' });
    vi.mocked(listDueBankConnectionIds).mockResolvedValue([7]);

    await scheduler.tick();

    expect(runSync).toHaveBeenCalledTimes(1);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('logs a failing user database and goes on with the next user', async () => {
    users.listUsersWithDatabase.mockResolvedValue(['alice', 'bob']);
    users.acquire.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    vi.mocked(listDueBankConnectionIds).mockResolvedValue([7]);

    await scheduler.tick();

    expect(runSync).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      '[hibiscus-backend] Scheduled syncs of alice failed:',
      expect.any(Error),
    );
  });

  it('logs a failed user listing and keeps ticking', async () => {
    users.listUsersWithDatabase.mockRejectedValueOnce(new Error('app db down'));
    vi.mocked(listDueBankConnectionIds).mockResolvedValue([]);

    await scheduler.tick();
    await scheduler.tick();

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(listDueBankConnectionIds).toHaveBeenCalledTimes(1);
  });
});

describe('SyncScheduler user keys', () => {
  it('gets each run’s key unattended for that run’s user', async () => {
    users.listUsersWithDatabase.mockResolvedValue(['alice', 'bob']);
    vi.mocked(listDueBankConnectionIds).mockResolvedValue([1]);
    runSync.mockImplementation(async ({ key }: SyncStartParams) => {
      await key();
    });

    await scheduler.tick();

    expect(keys.resolveUnattended.mock.calls).toEqual([['alice'], ['bob']]);
  });

  it.each<UnattendedKeyState>(['locked', 'manual', 'not-configured'])(
    'skips a user whose key is %s without opening their database',
    async (state: UnattendedKeyState) => {
      users.listUsersWithDatabase.mockResolvedValue(['alice', 'bob']);
      keys.unattendedState.mockImplementation(async (user: string) =>
        user === 'alice' ? state : 'ready',
      );
      vi.mocked(listDueBankConnectionIds).mockResolvedValue([7]);

      await scheduler.tick();

      expect(users.acquire.mock.calls).toEqual([['bob']]);
      expect(runSync).toHaveBeenCalledTimes(1);
      expect(console.error).not.toHaveBeenCalled();
    },
  );

  it('logs a skip once per change, not on every tick', async () => {
    vi.mocked(listDueBankConnectionIds).mockResolvedValue([]);
    keys.unattendedState.mockResolvedValue('locked');

    await scheduler.tick();
    await scheduler.tick();
    await scheduler.tick();
    expect(skipLogs()).toEqual([['[hibiscus-backend] Scheduled syncs of alice skipped: locked']]);

    keys.unattendedState.mockResolvedValue('ready');
    await scheduler.tick();
    await scheduler.tick();
    keys.unattendedState.mockResolvedValue('locked');
    await scheduler.tick();

    expect(skipLogs()).toEqual([
      ['[hibiscus-backend] Scheduled syncs of alice skipped: locked'],
      ['[hibiscus-backend] Scheduled syncs of alice resumed'],
      ['[hibiscus-backend] Scheduled syncs of alice skipped: locked'],
    ]);
  });

  it('skips a run refused as busy without an error', async () => {
    vi.mocked(listDueBankConnectionIds).mockResolvedValue([1, 2]);
    runSync.mockRejectedValueOnce(new UserBusyError('alice'));

    await scheduler.tick();

    expect(runSync).toHaveBeenCalledTimes(2);
    expect(console.error).not.toHaveBeenCalled();
  });
});
