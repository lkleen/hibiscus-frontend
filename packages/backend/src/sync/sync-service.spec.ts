import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscoverResponse } from '@hibiscus-frontend/shared/contracts/sync';

vi.mock('../db/pool', () => ({ currentUser: vi.fn() }));

import { currentUser } from '../db/pool';
import {
  beginReconfiguring,
  endReconfiguring,
  isUserBusy,
  UserBusyError,
} from '../db/user-activity';
import type { BankConnectionRecord } from '../repositories/bank-connection';
import { CredentialCrypto } from './credential-crypto';
import type { FetchedBooking } from './fetched-booking';
import type {
  FintsDiscovery,
  FintsSession,
  FintsSessionParams,
  StatementRequest,
} from './fints-session';
import { PendingTanRegistry } from './pending-tan-registry';
import type { PendingChallenge } from './pending-tan-registry';
import type { SyncDatabase } from './sync-database';
import { ConflictError, NotFoundError, SyncRunError, SyncService } from './sync-service';
import type { SyncServiceDeps, SyncStartParams, UserKeySource } from './sync-service';

const PIN = 'pin-7391-secret';
const USER = 'alice';

/** The user's key; the PINs of these tests are encrypted with it. */
const userKey: Buffer = randomBytes(32);
const USER_KEY_TEXT: string = userKey.toString('base64');
const crypto: CredentialCrypto = new CredentialCrypto(userKey);

/** The key buffers handed to runs, to check they are zeroed. */
let handedKeys: Buffer[];

function keySource(): UserKeySource {
  return async (): Promise<Buffer> => {
    const key: Buffer = Buffer.from(userKey);
    handedKeys.push(key);
    return key;
  };
}

function params(connectionId: number, trigger: SyncStartParams['trigger']): SyncStartParams {
  return { connectionId, trigger, key: keySource() };
}

function zeroed(key: Buffer | undefined): boolean {
  return key !== undefined && key.every((byte: number) => byte === 0);
}

const tanChallenge: PendingChallenge = {
  kind: 'tan',
  message: 'TAN bitte',
  image: null,
  reference: 'ref',
  pollDelayMs: null,
};

const booking: FetchedBooking = {
  bookingDate: '2026-10-21',
  valueDate: '2026-10-21',
  amount: -1,
  balanceAfter: 9,
  bookingText: null,
  primanota: null,
  customerRef: null,
  gvCode: null,
  addKey: null,
  counterpartyAccount: null,
  counterpartyBlz: null,
  counterpartyName: null,
  counterpartyName2: null,
  purposeLines: [],
  pending: false,
};

const discovery: FintsDiscovery = {
  tanMethods: [{ id: 902, name: 'pushTAN', decoupled: true, media: [], mediaRequired: false }],
  selectedTanMethod: 902,
  tanMedia: [],
  accounts: [
    { identifier: 'DE02 1203', iban: 'DE02 1203', accountNumber: '1203', name: 'Giro' },
    { identifier: '0042', iban: null, accountNumber: '0042', name: null },
    { identifier: '777', iban: null, accountNumber: '777', name: null },
  ],
};

function record(): BankConnectionRecord {
  return {
    id: 3,
    settings: {
      name: 'comdirect',
      blz: '20041177',
      fintsUrl: 'https://fints.comdirect.de/fints',
      loginName: 'user',
      customerId: null,
      tanMethod: 902,
      tanMedia: null,
      syncIntervalHours: 6,
      enabled: true,
    },
    pin: crypto.encrypt(PIN),
    bankingInformation: '{"systemId":"s"}',
    accounts: [
      { accountIdentifier: 'DE111', kontoId: 11, enabled: true },
      { accountIdentifier: 'DE222', kontoId: 22, enabled: false },
    ],
  };
}

type Fake<T> = { [K in keyof T]: ReturnType<typeof vi.fn> };

let lock: { connectionId: number; release: ReturnType<typeof vi.fn> };
let lockAcquired: boolean;
let latestBooked: string | null;
let syncDatabase: Fake<SyncDatabase>;
let bankConnections: Fake<SyncServiceDeps['bankConnections']>;
let syncRuns: Fake<SyncServiceDeps['syncRuns']>;
let session: { [K in keyof FintsSession]: ReturnType<typeof vi.fn> };
let sessionParams: FintsSessionParams | undefined;
let registry: PendingTanRegistry;
let service: SyncService;

function newService(timeoutMs: number): SyncService {
  registry = new PendingTanRegistry(timeoutMs);
  return new SyncService({
    sessions: async (params: FintsSessionParams): Promise<FintsSession> => {
      sessionParams = params;
      return session as unknown as FintsSession;
    },
    registry,
    syncDatabase: syncDatabase as unknown as SyncDatabase,
    bankConnections: bankConnections as unknown as SyncServiceDeps['bankConnections'],
    syncRuns: syncRuns as unknown as SyncServiceDeps['syncRuns'],
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  lockAcquired = true;
  latestBooked = '2026-10-20';
  sessionParams = undefined;
  handedKeys = [];
  vi.mocked(currentUser).mockReturnValue({ user: USER, database: null });
  lock = { connectionId: 3, release: vi.fn() };
  syncDatabase = {
    lock: vi.fn(async () => (lockAcquired ? lock : null)),
    latestBookedDate: vi.fn(async () => latestBooked),
    mergeInTransaction: vi.fn().mockResolvedValue({ inserted: 2, deleted: 1 }),
  };
  bankConnections = {
    list: vi.fn(),
    getRecord: vi.fn().mockResolvedValue(record()),
    delete: vi.fn(),
    saveBankingInformation: vi.fn(),
    recordOutcome: vi.fn(),
    setPaused: vi.fn(),
    listKontoMatchKeys: vi.fn(),
  };
  syncRuns = {
    create: vi.fn().mockResolvedValue(41),
    setWaiting: vi.fn(),
    finish: vi.fn(),
    listLatest: vi.fn(),
  };
  bankConnections.listKontoMatchKeys.mockResolvedValue([
    { id: 5, iban: 'de021203', kontonummer: '9' },
    { id: 6, iban: null, kontonummer: '42' },
  ]);
  session = {
    discover: vi.fn().mockResolvedValue(discovery),
    fetchStatements: vi.fn().mockResolvedValue([booking]),
    fetchBalance: vi.fn().mockResolvedValue({ booked: 9, available: 100 }),
  };
  service = newService(15 * 60 * 1000);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SyncService.runSync', () => {
  it('fetches every enabled account, merges it in one transaction and records success', async () => {
    await service.runSync(params(3, 'manual'));

    expect(syncDatabase.lock).toHaveBeenCalledWith(3);
    expect(bankConnections.setPaused).toHaveBeenCalledWith(3, null);
    expect(syncRuns.create).toHaveBeenCalledWith(3, 'manual');
    expect(sessionParams?.login.pin).toBe(PIN);
    expect(session.fetchStatements).toHaveBeenCalledTimes(1);
    const request: StatementRequest = session.fetchStatements.mock.calls[0]?.[0];
    expect(request.accountIdentifier).toBe('DE111');
    expect([request.from.getFullYear(), request.from.getMonth(), request.from.getDate()]).toEqual([
      2026, 9, 10,
    ]);
    expect(syncDatabase.latestBookedDate).toHaveBeenCalledWith(lock, 11);
    expect(syncDatabase.mergeInTransaction).toHaveBeenCalledTimes(1);
    expect(syncDatabase.mergeInTransaction).toHaveBeenCalledWith(lock, {
      kontoId: 11,
      bookings: [booking],
      balance: { booked: 9, available: 100 },
    });
    expect(syncRuns.finish).toHaveBeenCalledWith(41, {
      status: 'success',
      error: null,
      inserted: 2,
      deleted: 1,
    });
    expect(bankConnections.recordOutcome).toHaveBeenCalledWith(3, {
      status: 'success',
      error: null,
    });
    expect(lock.release).toHaveBeenCalledTimes(1);
  });

  it('fetches the initial 90 days for an account without booked rows', async () => {
    latestBooked = null;
    const before: Date = new Date();

    await service.runSync(params(3, 'scheduled'));

    const request: StatementRequest = session.fetchStatements.mock.calls[0]?.[0];
    const days: number = Math.round((before.getTime() - request.from.getTime()) / 86_400_000);
    expect(days).toBeGreaterThanOrEqual(90);
    expect(days).toBeLessThanOrEqual(91);
    expect(bankConnections.setPaused).not.toHaveBeenCalled();
  });

  it('persists the bank parameter data through the session callback', async () => {
    await service.runSync(params(3, 'manual'));
    await sessionParams?.saveBankingInformation('{"x":1}');

    expect(bankConnections.saveBankingInformation).toHaveBeenCalledWith(3, '{"x":1}');
  });

  it('throws ConflictError without a run when the lock is taken', async () => {
    lockAcquired = false;

    await expect(service.runSync(params(3, 'manual'))).rejects.toBeInstanceOf(ConflictError);
    expect(syncRuns.create).not.toHaveBeenCalled();
    expect(bankConnections.getRecord).not.toHaveBeenCalled();
    expect(lock.release).not.toHaveBeenCalled();
  });

  it('throws NotFoundError and frees the lock for an unknown connection', async () => {
    bankConnections.getRecord.mockResolvedValueOnce(null);

    await expect(service.runSync(params(3, 'manual'))).rejects.toBeInstanceOf(NotFoundError);
    expect(lock.release).toHaveBeenCalledTimes(1);
  });

  it('records the error when the merge fails', async () => {
    syncDatabase.mergeInTransaction.mockRejectedValueOnce(new Error('merge broke'));

    await expect(service.runSync(params(3, 'manual'))).rejects.toBeInstanceOf(SyncRunError);
    expect(syncRuns.finish).toHaveBeenCalledWith(41, {
      status: 'error',
      error: 'merge broke',
      inserted: 0,
      deleted: 0,
    });
    expect(bankConnections.recordOutcome).toHaveBeenCalledWith(3, {
      status: 'error',
      error: 'merge broke',
    });
    expect(lock.release).toHaveBeenCalledTimes(1);
  });

  it('masks the PIN in recorded and thrown errors', async () => {
    session.fetchStatements.mockRejectedValueOnce(new Error(`bank echoed PIN ${PIN} back`));

    const error: unknown = await service.runSync(params(3, 'manual')).catch((e: unknown) => e);

    expect(String((error as Error).message)).not.toContain(PIN);
    expect(String((error as Error).stack)).not.toContain(PIN);
    expect(JSON.stringify(syncRuns.finish.mock.calls)).not.toContain(PIN);
    expect(JSON.stringify(bankConnections.recordOutcome.mock.calls)).not.toContain(PIN);
    expect(syncRuns.finish.mock.calls[0]?.[1].error).toBe('bank echoed PIN *** back');
  });
});

describe('SyncService TAN handling', () => {
  it('waits for the answered TAN and mirrors the wait into the run', async () => {
    session.fetchStatements.mockImplementationOnce(async () => {
      const tan: string | undefined = await sessionParams?.prompt.request(tanChallenge);
      await sessionParams?.prompt.settled();
      expect(tan).toBe('123');
      return [booking];
    });

    const started = await service.startSync(params(3, 'manual'));
    await vi.waitFor(() => expect(registry.openChallenge(41)).not.toBeNull());
    await vi.waitFor(() => expect(syncRuns.setWaiting).toHaveBeenCalledWith(41, true));
    expect(registry.answer(41, '123')).toBe('accepted');
    await started.done;

    expect(syncRuns.setWaiting).toHaveBeenLastCalledWith(41, false);
    expect(syncRuns.finish).toHaveBeenCalledWith(
      41,
      expect.objectContaining({ status: 'success' }),
    );
    expect(registry.openChallenge(41)).toBeNull();
  });

  it('expires a scheduled run whose TAN nobody answers and pauses the connection', async () => {
    service = newService(20);
    session.fetchStatements.mockImplementationOnce(async () => {
      await sessionParams?.prompt.request(tanChallenge);
      return [];
    });

    await expect(service.runSync(params(3, 'scheduled'))).rejects.toBeInstanceOf(SyncRunError);

    expect(syncRuns.finish).toHaveBeenCalledWith(
      41,
      expect.objectContaining({ status: 'tan_expired' }),
    );
    expect(bankConnections.recordOutcome).toHaveBeenCalledWith(
      3,
      expect.objectContaining({ status: 'tan_expired' }),
    );
    expect(bankConnections.setPaused).toHaveBeenCalledWith(3, 'tan');
    expect(lock.release).toHaveBeenCalledTimes(1);
  });

  it('does not pause the connection when a manual run expires', async () => {
    service = newService(20);
    session.fetchStatements.mockImplementationOnce(async () => {
      await sessionParams?.prompt.request(tanChallenge);
      return [];
    });

    await expect(service.runSync(params(3, 'manual'))).rejects.toBeInstanceOf(SyncRunError);

    expect(bankConnections.setPaused).toHaveBeenCalledTimes(1);
    expect(bankConnections.setPaused).toHaveBeenCalledWith(3, null);
  });
});

describe('SyncService.discover', () => {
  it('answers with the accounts matched to kontos by IBAN or account number', async () => {
    const response: DiscoverResponse = await service.discover({
      connectionId: 3,
      key: keySource(),
    });

    expect(syncRuns.create).toHaveBeenCalledWith(3, 'discover');
    expect(response).toEqual({
      status: 'done',
      tanMethods: discovery.tanMethods,
      selectedTanMethod: 902,
      tanMedia: [],
      accounts: [
        { ...discovery.accounts[0], kontoId: 5 },
        { ...discovery.accounts[1], kontoId: 6 },
        { ...discovery.accounts[2], kontoId: null },
      ],
    });
    expect(bankConnections.recordOutcome).not.toHaveBeenCalled();
    expect(lock.release).toHaveBeenCalledTimes(1);
  });

  it('answers with the challenge and finishes the discovery in the background', async () => {
    let finish: () => void = (): void => undefined;
    const finished: Promise<void> = new Promise<void>((resolve: () => void) => {
      finish = resolve;
    });
    session.discover.mockImplementationOnce(async () => {
      await sessionParams?.prompt.request(tanChallenge);
      await sessionParams?.prompt.settled();
      finish();
      return discovery;
    });

    const response: DiscoverResponse = await service.discover({
      connectionId: 3,
      key: keySource(),
    });

    expect(response).toEqual({
      status: 'tan_required',
      runId: 41,
      challenge: { kind: 'tan', message: 'TAN bitte', hasImage: false },
    });
    expect(lock.release).toHaveBeenCalledTimes(0);
    expect(registry.answer(41, '1')).toBe('accepted');
    await finished;
    await vi.waitFor(() => expect(lock.release).toHaveBeenCalledTimes(1));
    expect(syncRuns.finish).toHaveBeenCalledWith(
      41,
      expect.objectContaining({ status: 'success' }),
    );
  });

  it('throws ConflictError while a run holds the lock', async () => {
    lockAcquired = false;

    await expect(service.discover({ connectionId: 3, key: keySource() })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});

describe('SyncService.deleteConnection', () => {
  it('deletes under the connection lock and releases it', async () => {
    bankConnections.delete.mockResolvedValueOnce(true);

    expect(await service.deleteConnection(3)).toBe(true);
    expect(syncDatabase.lock).toHaveBeenCalledWith(3);
    expect(bankConnections.delete).toHaveBeenCalledWith(3);
    expect(lock.release).toHaveBeenCalledTimes(1);
  });

  it('throws ConflictError without deleting while a run holds the lock', async () => {
    lockAcquired = false;

    await expect(service.deleteConnection(3)).rejects.toBeInstanceOf(ConflictError);
    expect(bankConnections.delete).not.toHaveBeenCalled();
    expect(lock.release).not.toHaveBeenCalled();
  });

  it('releases the lock when the delete fails', async () => {
    bankConnections.delete.mockRejectedValueOnce(new Error('db'));

    await expect(service.deleteConnection(3)).rejects.toThrow('db');
    expect(lock.release).toHaveBeenCalledTimes(1);
  });
});

describe('SyncService.status', () => {
  it('combines connections, latest runs and open challenges', async () => {
    bankConnections.list.mockResolvedValue([
      {
        id: 3,
        ...record().settings,
        accounts: [],
        pausedReason: 'tan',
        lastSyncAt: null,
        lastStatus: null,
        lastError: null,
      },
    ]);
    syncRuns.listLatest.mockResolvedValue(new Map());
    void registry.createPrompt({ runId: 41, connectionId: 3 }).request(tanChallenge);

    const status = await service.status();

    expect(status).toEqual([
      {
        id: 3,
        name: 'comdirect',
        enabled: true,
        pausedReason: 'tan',
        lastSyncAt: null,
        lastStatus: null,
        lastError: null,
        latestRun: null,
        challenge: { runId: 41, kind: 'tan', message: 'TAN bitte', hasImage: false },
      },
    ]);
    registry.release(41);
  });
});

describe('SyncService user key and busy mark', () => {
  it('marks the user busy for the whole run and zeroes the key when it ends', async () => {
    let busyDuringRun = false;
    session.fetchStatements.mockImplementationOnce(async () => {
      busyDuringRun = isUserBusy(USER);
      expect(zeroed(handedKeys[0])).toBe(false);
      return [booking];
    });

    await service.runSync(params(3, 'manual'));

    expect(busyDuringRun).toBe(true);
    expect(isUserBusy(USER)).toBe(false);
    expect(zeroed(handedKeys[0])).toBe(true);
  });

  it('keeps a manual run’s key through its TAN wait and drops it when the run ends', async () => {
    session.fetchStatements.mockImplementationOnce(async () => {
      await sessionParams?.prompt.request(tanChallenge);
      await sessionParams?.prompt.settled();
      return [booking];
    });

    const started = await service.startSync(params(3, 'manual'));
    await vi.waitFor(() => expect(registry.openChallenge(41)).not.toBeNull());
    expect(zeroed(handedKeys[0])).toBe(false);
    expect(isUserBusy(USER)).toBe(true);
    registry.answer(41, '123');
    await started.done;

    expect(zeroed(handedKeys[0])).toBe(true);
    expect(isUserBusy(USER)).toBe(false);
  });

  it('refuses a run while the user is reconfiguring, before asking for the key', async () => {
    const source: ReturnType<typeof vi.fn> = vi.fn(keySource());
    beginReconfiguring(USER);
    try {
      await expect(
        service.startSync({ connectionId: 3, trigger: 'manual', key: source as UserKeySource }),
      ).rejects.toBeInstanceOf(UserBusyError);
      await expect(
        service.discover({ connectionId: 3, key: source as UserKeySource }),
      ).rejects.toBeInstanceOf(UserBusyError);
    } finally {
      endReconfiguring(USER);
    }

    expect(source).not.toHaveBeenCalled();
    expect(syncDatabase.lock).not.toHaveBeenCalled();
    expect(syncRuns.create).not.toHaveBeenCalled();
  });

  it('starts nothing when the key is refused, and clears the busy mark', async () => {
    const refused: Error = new Error('key-invalid');

    await expect(
      service.startSync({ connectionId: 3, trigger: 'manual', key: () => Promise.reject(refused) }),
    ).rejects.toBe(refused);

    expect(syncDatabase.lock).not.toHaveBeenCalled();
    expect(syncRuns.create).not.toHaveBeenCalled();
    expect(isUserBusy(USER)).toBe(false);
  });

  it('throws a failed lock release and still clears the busy mark', async () => {
    const releaseFailed: Error = new Error('release failed');
    lock.release.mockRejectedValueOnce(releaseFailed);

    await expect(service.runSync(params(3, 'manual'))).rejects.toBe(releaseFailed);

    expect(zeroed(handedKeys[0])).toBe(true);
    expect(isUserBusy(USER)).toBe(false);
  });

  it('zeroes the key and clears the busy mark when the lock is taken', async () => {
    lockAcquired = false;

    await expect(service.startSync(params(3, 'manual'))).rejects.toBeInstanceOf(ConflictError);

    expect(zeroed(handedKeys[0])).toBe(true);
    expect(isUserBusy(USER)).toBe(false);
  });

  it('records a run without a PIN as an error that asks for the PIN', async () => {
    bankConnections.getRecord.mockResolvedValueOnce({ ...record(), pin: null });

    await expect(service.runSync(params(3, 'manual'))).rejects.toBeInstanceOf(SyncRunError);

    expect(sessionParams).toBeUndefined();
    expect(syncRuns.finish.mock.calls[0]?.[1].error).toContain('enter the PIN again');
    expect(isUserBusy(USER)).toBe(false);
  });

  it('records a PIN the key cannot decrypt without opening a session', async () => {
    bankConnections.getRecord.mockResolvedValueOnce({
      ...record(),
      pin: new CredentialCrypto(randomBytes(32)).encrypt(PIN),
    });

    await expect(service.runSync(params(3, 'manual'))).rejects.toBeInstanceOf(SyncRunError);

    expect(sessionParams).toBeUndefined();
    expect(syncRuns.finish.mock.calls[0]?.[1].error).toContain('cannot be decrypted');
  });

  it('masks the key in recorded and thrown errors', async () => {
    session.fetchStatements.mockRejectedValueOnce(new Error(`echo ${USER_KEY_TEXT} and ${PIN}`));

    const error: unknown = await service.runSync(params(3, 'manual')).catch((e: unknown) => e);

    const recorded: string = JSON.stringify([
      syncRuns.finish.mock.calls,
      bankConnections.recordOutcome.mock.calls,
    ]);
    for (const secret of [USER_KEY_TEXT, PIN]) {
      expect(String((error as Error).message)).not.toContain(secret);
      expect(String((error as Error).stack)).not.toContain(secret);
      expect(recorded).not.toContain(secret);
    }
    expect(syncRuns.finish.mock.calls[0]?.[1].error).toBe('echo *** and ***');
  });
});
