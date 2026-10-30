import { randomBytes } from 'node:crypto';
import type { Pool } from 'mysql2/promise';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscoverResponse } from '@hibiscus-frontend/shared/contracts/sync';

vi.mock('../db/pool', () => ({ getPool: vi.fn() }));
vi.mock('../repositories/bank-connection', () => ({
  deleteBankConnection: vi.fn(),
  getBankConnectionRecord: vi.fn(),
  listBankConnections: vi.fn(),
  listKontoMatchKeys: vi.fn(),
  recordBankConnectionOutcome: vi.fn(),
  saveBankingInformation: vi.fn(),
  setBankConnectionPaused: vi.fn(),
}));
vi.mock('../repositories/sync-run', () => ({
  createSyncRun: vi.fn(),
  finishSyncRun: vi.fn(),
  listLatestSyncRuns: vi.fn(),
  setSyncRunWaiting: vi.fn(),
}));
vi.mock('./umsatz-merge', () => ({ mergeStatement: vi.fn() }));

import { getPool } from '../db/pool';
import {
  deleteBankConnection,
  getBankConnectionRecord,
  listBankConnections,
  listKontoMatchKeys,
  recordBankConnectionOutcome,
  saveBankingInformation,
  setBankConnectionPaused,
} from '../repositories/bank-connection';
import type { BankConnectionRecord } from '../repositories/bank-connection';
import {
  createSyncRun,
  finishSyncRun,
  listLatestSyncRuns,
  setSyncRunWaiting,
} from '../repositories/sync-run';
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
import { ConflictError, NotFoundError, SyncRunError, SyncService } from './sync-service';
import { mergeStatement } from './umsatz-merge';

const PIN = 'pin-7391-secret';

const crypto: CredentialCrypto = new CredentialCrypto(randomBytes(32));

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

interface FakeLock {
  query: ReturnType<typeof vi.fn>;
  beginTransaction: ReturnType<typeof vi.fn>;
  commit: ReturnType<typeof vi.fn>;
  rollback: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

let lock: FakeLock;
let lockAcquired: number;
let latestBooked: string | null;
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
    crypto,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  lockAcquired = 1;
  latestBooked = '2026-10-20';
  sessionParams = undefined;
  lock = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('GET_LOCK')) return [[{ acquired: lockAcquired }]];
      if (sql.includes('MAX(datum)')) return [[{ latest: latestBooked }]];
      return [[{}]];
    }),
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
    destroy: vi.fn(),
  };
  vi.mocked(getPool).mockReturnValue({
    getConnection: vi.fn().mockResolvedValue(lock),
  } as unknown as Pool);
  vi.mocked(getBankConnectionRecord).mockResolvedValue(record());
  vi.mocked(createSyncRun).mockResolvedValue(41);
  vi.mocked(mergeStatement).mockResolvedValue({ inserted: 2, deleted: 1 });
  vi.mocked(listKontoMatchKeys).mockResolvedValue([
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

function lockCalls(fragment: string): unknown[][] {
  return lock.query.mock.calls.filter((call: unknown[]) => String(call[0]).includes(fragment));
}

describe('SyncService.runSync', () => {
  it('fetches every enabled account, merges it in one transaction and records success', async () => {
    await service.runSync(3, 'manual');

    expect(lockCalls('GET_LOCK')[0]?.[1]).toEqual(['hf_sync_3']);
    expect(setBankConnectionPaused).toHaveBeenCalledWith(3, null);
    expect(createSyncRun).toHaveBeenCalledWith(3, 'manual');
    expect(sessionParams?.login.pin).toBe(PIN);
    expect(session.fetchStatements).toHaveBeenCalledTimes(1);
    const request: StatementRequest = session.fetchStatements.mock.calls[0]?.[0];
    expect(request.accountIdentifier).toBe('DE111');
    expect([request.from.getFullYear(), request.from.getMonth(), request.from.getDate()]).toEqual([
      2026, 9, 10,
    ]);
    expect(mergeStatement).toHaveBeenCalledWith(lock, {
      kontoId: 11,
      bookings: [booking],
      balance: { booked: 9, available: 100 },
    });
    expect(lock.beginTransaction).toHaveBeenCalledTimes(1);
    expect(lock.commit).toHaveBeenCalledTimes(1);
    expect(finishSyncRun).toHaveBeenCalledWith(41, {
      status: 'success',
      error: null,
      inserted: 2,
      deleted: 1,
    });
    expect(recordBankConnectionOutcome).toHaveBeenCalledWith(3, { status: 'success', error: null });
    expect(lockCalls('RELEASE_LOCK')).toHaveLength(1);
    expect(lock.release).toHaveBeenCalledTimes(1);
  });

  it('fetches the initial 90 days for an account without booked rows', async () => {
    latestBooked = null;
    const before: Date = new Date();

    await service.runSync(3, 'scheduled');

    const request: StatementRequest = session.fetchStatements.mock.calls[0]?.[0];
    const days: number = Math.round((before.getTime() - request.from.getTime()) / 86_400_000);
    expect(days).toBeGreaterThanOrEqual(90);
    expect(days).toBeLessThanOrEqual(91);
    expect(setBankConnectionPaused).not.toHaveBeenCalled();
  });

  it('persists the bank parameter data through the session callback', async () => {
    await service.runSync(3, 'manual');
    await sessionParams?.saveBankingInformation('{"x":1}');

    expect(saveBankingInformation).toHaveBeenCalledWith(3, '{"x":1}');
  });

  it('throws ConflictError without a run when the lock is taken', async () => {
    lockAcquired = 0;

    await expect(service.runSync(3, 'manual')).rejects.toBeInstanceOf(ConflictError);
    expect(createSyncRun).not.toHaveBeenCalled();
    expect(lock.release).toHaveBeenCalledTimes(1);
    expect(lockCalls('RELEASE_LOCK')).toHaveLength(0);
  });

  it('throws NotFoundError and frees the lock for an unknown connection', async () => {
    vi.mocked(getBankConnectionRecord).mockResolvedValueOnce(null);

    await expect(service.runSync(3, 'manual')).rejects.toBeInstanceOf(NotFoundError);
    expect(lockCalls('RELEASE_LOCK')).toHaveLength(1);
    expect(lock.release).toHaveBeenCalledTimes(1);
  });

  it('rolls the merge back and records the error', async () => {
    vi.mocked(mergeStatement).mockRejectedValueOnce(new Error('merge broke'));

    await expect(service.runSync(3, 'manual')).rejects.toBeInstanceOf(SyncRunError);
    expect(lock.rollback).toHaveBeenCalledTimes(1);
    expect(finishSyncRun).toHaveBeenCalledWith(41, {
      status: 'error',
      error: 'merge broke',
      inserted: 0,
      deleted: 0,
    });
    expect(recordBankConnectionOutcome).toHaveBeenCalledWith(3, {
      status: 'error',
      error: 'merge broke',
    });
    expect(lockCalls('RELEASE_LOCK')).toHaveLength(1);
  });

  it('masks the PIN in recorded and thrown errors', async () => {
    session.fetchStatements.mockRejectedValueOnce(new Error(`bank echoed PIN ${PIN} back`));

    const error: unknown = await service.runSync(3, 'manual').catch((e: unknown) => e);

    expect(String((error as Error).message)).not.toContain(PIN);
    expect(String((error as Error).stack)).not.toContain(PIN);
    expect(JSON.stringify(vi.mocked(finishSyncRun).mock.calls)).not.toContain(PIN);
    expect(JSON.stringify(vi.mocked(recordBankConnectionOutcome).mock.calls)).not.toContain(PIN);
    expect(vi.mocked(finishSyncRun).mock.calls[0]?.[1].error).toBe('bank echoed PIN *** back');
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

    const started = await service.startSync(3, 'manual');
    await vi.waitFor(() => expect(registry.openChallenge(41)).not.toBeNull());
    await vi.waitFor(() => expect(setSyncRunWaiting).toHaveBeenCalledWith(41, true));
    expect(registry.answer(41, '123')).toBe('accepted');
    await started.done;

    expect(setSyncRunWaiting).toHaveBeenLastCalledWith(41, false);
    expect(finishSyncRun).toHaveBeenCalledWith(41, expect.objectContaining({ status: 'success' }));
    expect(registry.openChallenge(41)).toBeNull();
  });

  it('expires a scheduled run whose TAN nobody answers and pauses the connection', async () => {
    service = newService(20);
    session.fetchStatements.mockImplementationOnce(async () => {
      await sessionParams?.prompt.request(tanChallenge);
      return [];
    });

    await expect(service.runSync(3, 'scheduled')).rejects.toBeInstanceOf(SyncRunError);

    expect(finishSyncRun).toHaveBeenCalledWith(
      41,
      expect.objectContaining({ status: 'tan_expired' }),
    );
    expect(recordBankConnectionOutcome).toHaveBeenCalledWith(
      3,
      expect.objectContaining({ status: 'tan_expired' }),
    );
    expect(setBankConnectionPaused).toHaveBeenCalledWith(3, 'tan');
    expect(lockCalls('RELEASE_LOCK')).toHaveLength(1);
  });

  it('does not pause the connection when a manual run expires', async () => {
    service = newService(20);
    session.fetchStatements.mockImplementationOnce(async () => {
      await sessionParams?.prompt.request(tanChallenge);
      return [];
    });

    await expect(service.runSync(3, 'manual')).rejects.toBeInstanceOf(SyncRunError);

    expect(setBankConnectionPaused).toHaveBeenCalledTimes(1);
    expect(setBankConnectionPaused).toHaveBeenCalledWith(3, null);
  });
});

describe('SyncService.discover', () => {
  it('answers with the accounts matched to kontos by IBAN or account number', async () => {
    const response: DiscoverResponse = await service.discover(3);

    expect(createSyncRun).toHaveBeenCalledWith(3, 'discover');
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
    expect(recordBankConnectionOutcome).not.toHaveBeenCalled();
    expect(lockCalls('RELEASE_LOCK')).toHaveLength(1);
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

    const response: DiscoverResponse = await service.discover(3);

    expect(response).toEqual({
      status: 'tan_required',
      runId: 41,
      challenge: { kind: 'tan', message: 'TAN bitte', hasImage: false },
    });
    expect(lockCalls('RELEASE_LOCK')).toHaveLength(0);
    expect(registry.answer(41, '1')).toBe('accepted');
    await finished;
    await vi.waitFor(() => expect(lockCalls('RELEASE_LOCK')).toHaveLength(1));
    expect(finishSyncRun).toHaveBeenCalledWith(41, expect.objectContaining({ status: 'success' }));
  });

  it('throws ConflictError while a run holds the lock', async () => {
    lockAcquired = 0;

    await expect(service.discover(3)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('SyncService.deleteConnection', () => {
  it('deletes under the connection lock and releases it', async () => {
    vi.mocked(deleteBankConnection).mockResolvedValueOnce(true);

    expect(await service.deleteConnection(3)).toBe(true);
    expect(lockCalls('GET_LOCK')[0]?.[1]).toEqual(['hf_sync_3']);
    expect(deleteBankConnection).toHaveBeenCalledWith(3);
    expect(lockCalls('RELEASE_LOCK')).toHaveLength(1);
    expect(lock.release).toHaveBeenCalledTimes(1);
  });

  it('throws ConflictError without deleting while a run holds the lock', async () => {
    lockAcquired = 0;

    await expect(service.deleteConnection(3)).rejects.toBeInstanceOf(ConflictError);
    expect(deleteBankConnection).not.toHaveBeenCalled();
    expect(lock.release).toHaveBeenCalledTimes(1);
  });

  it('releases the lock when the delete fails', async () => {
    vi.mocked(deleteBankConnection).mockRejectedValueOnce(new Error('db'));

    await expect(service.deleteConnection(3)).rejects.toThrow('db');
    expect(lockCalls('RELEASE_LOCK')).toHaveLength(1);
  });
});

describe('SyncService.status', () => {
  it('combines connections, latest runs and open challenges', async () => {
    vi.mocked(listBankConnections).mockResolvedValue([
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
    vi.mocked(listLatestSyncRuns).mockResolvedValue(new Map());
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
