import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import type {
  BankConnection,
  BankConnectionAccount,
  DiscoverDone,
  DiscoverResponse,
  DiscoverTanRequired,
  DiscoveredAccount,
  SyncConnectionStatus,
  SyncRun,
  SyncRunStatus,
  SyncTrigger,
  TanChallenge,
} from '@hibiscus-frontend/shared/contracts/sync';
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
import type { BankConnectionRecord, KontoMatchKey } from '../repositories/bank-connection';
import {
  createSyncRun,
  finishSyncRun,
  listLatestSyncRuns,
  setSyncRunWaiting,
} from '../repositories/sync-run';
import type { CredentialCrypto } from './credential-crypto';
import type { FetchedBooking, MergeResult, StatementBalance } from './fetched-booking';
import { describeStoredBankingInformation } from './fints-session';
import type { FintsDiscovery, FintsSession, FintsSessionFactory } from './fints-session';
import { TanTimeoutError } from './pending-tan-registry';
import type { PendingChallenge, PendingTanRegistry, TanPrompt } from './pending-tan-registry';
import { mergeStatement } from './umsatz-merge';

/** A run or discovery of the connection is already in progress (`GET_LOCK` not acquired). */
export class ConflictError extends Error {
  constructor(connectionId: number) {
    super(`Bank connection ${connectionId} already has a run in progress`);
    this.name = 'ConflictError';
  }
}

/** The connection does not exist. */
export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} does not exist`);
    this.name = 'NotFoundError';
  }
}

/** A failed run, its message and stack with the PIN masked. */
export class SyncRunError extends Error {
  constructor(runId: number, message: string) {
    super(`Run ${runId} failed: ${message}`);
    this.name = 'SyncRunError';
  }
}

export interface SyncServiceDeps {
  readonly sessions: FintsSessionFactory;
  readonly registry: PendingTanRegistry;
  readonly crypto: CredentialCrypto;
}

/** A run that holds its connection's lock; `done` settles when the run has finished. */
export interface StartedRun {
  readonly runId: number;
  readonly done: Promise<void>;
}

type RunTrigger = Exclude<SyncTrigger, 'discover'>;

interface LockRow extends RowDataPacket {
  acquired: number | null;
}

interface LatestDateRow extends RowDataPacket {
  latest: string | null;
}

/** What a run works with while it holds the lock. */
interface RunContext {
  readonly runId: number;
  readonly trigger: SyncTrigger;
  readonly record: BankConnectionRecord;
  /** The pooled connection that holds `GET_LOCK` for the whole run; merges run on it too. */
  readonly lock: PoolConnection;
  /** Discovery only: told about the first TAN challenge. */
  readonly onChallenge?: (challenge: PendingChallenge) => void;
}

/** Days fetched again before the newest booked row, so late bookings are not missed. */
const OVERLAP_DAYS = 10;
/** Days fetched for an account without any booked row yet. */
const INITIAL_DAYS = 90;

function lockName(connectionId: number): string {
  return `hf_sync_${connectionId}`;
}

function localDay(date: Date, offsetDays: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offsetDays);
}

/** Masks every occurrence of the PIN. */
function redact(text: string, pin: string): string {
  return pin === '' ? text : text.split(pin).join('***');
}

function messageOf(error: unknown): string {
  if (error instanceof AggregateError) return error.errors.map(messageOf).join('; ');
  return error instanceof Error ? error.message : String(error);
}

function toPublicChallenge(challenge: PendingChallenge): TanChallenge {
  return { kind: challenge.kind, message: challenge.message, hasImage: challenge.image !== null };
}

function normalizeIban(iban: string): string {
  return iban.replace(/\s+/g, '').toUpperCase();
}

function stripLeadingZeros(value: string): string {
  return value.replace(/^0+/, '');
}

/** The konto with the same IBAN, else the same account number. */
function matchKonto(
  account: Omit<DiscoveredAccount, 'kontoId'>,
  kontos: readonly KontoMatchKey[],
): number | null {
  const iban: string | null = account.iban === null ? null : normalizeIban(account.iban);
  const byIban: KontoMatchKey | undefined =
    iban === null
      ? undefined
      : kontos.find(
          (konto: KontoMatchKey) => konto.iban !== null && normalizeIban(konto.iban) === iban,
        );
  const byNumber: KontoMatchKey | undefined = kontos.find(
    (konto: KontoMatchKey) =>
      stripLeadingZeros(konto.kontonummer) === stripLeadingZeros(account.accountNumber),
  );
  return (byIban ?? byNumber)?.id ?? null;
}

/**
 * Runs bank syncs and discoveries. One at a time per connection: each holds the MariaDB lock
 * `hf_sync_<id>` on a dedicated pooled connection for its whole duration, a second attempt gets a
 * `ConflictError` at once.
 */
export class SyncService {
  constructor(private readonly deps: SyncServiceDeps) {}

  /**
   * Starts a sync and returns once it holds the lock and has its run row; the run itself goes on
   * in `done`. A manual run clears the connection's pause. Throws `ConflictError` / `NotFoundError`.
   */
  async startSync(connectionId: number, trigger: RunTrigger): Promise<StartedRun> {
    const { lock, record, runId } = await this.begin(connectionId, trigger);
    const done: Promise<void> = this.executeSync({ runId, trigger, record, lock }).finally(() =>
      this.unlock(lock, connectionId),
    );
    return { runId, done };
  }

  /** Starts a sync and waits for it to finish; throws what the run threw. */
  async runSync(connectionId: number, trigger: RunTrigger): Promise<void> {
    const started: StartedRun = await this.startSync(connectionId, trigger);
    await started.done;
  }

  /**
   * Discovers TAN methods and accounts. Answers with the result, or as soon as the bank asks for a
   * TAN with the challenge; the discovery then goes on in the background and its result is read
   * later with `describeDiscovery`.
   */
  async discover(connectionId: number): Promise<DiscoverResponse> {
    const { lock, record, runId } = await this.begin(connectionId, 'discover');
    let announce: (response: DiscoverTanRequired) => void = (): void => {
      throw new Error('The challenge listener is not set up yet');
    };
    const challenged: Promise<DiscoverTanRequired> = new Promise<DiscoverTanRequired>(
      (resolve: (response: DiscoverTanRequired) => void): void => {
        announce = resolve;
      },
    );
    const onChallenge = (challenge: PendingChallenge): void =>
      announce({ status: 'tan_required', runId, challenge: toPublicChallenge(challenge) });
    const done: Promise<DiscoverDone> = this.executeDiscover({
      runId,
      trigger: 'discover',
      record,
      lock,
      onChallenge,
    }).finally(() => this.unlock(lock, connectionId));
    const first: DiscoverResponse = await Promise.race([done, challenged]);
    if (first.status === 'tan_required') {
      done.catch((error: unknown) => {
        console.error(`[hibiscus-backend] Discovery run ${runId} failed:`, error);
      });
    }
    return first;
  }

  /** The last discovery's result from the stored bank parameter data, `null` if there is none. */
  async describeDiscovery(connectionId: number): Promise<DiscoverDone | null> {
    const record: BankConnectionRecord | null = await getBankConnectionRecord(connectionId);
    if (record === null) throw new NotFoundError(`Bank connection ${connectionId}`);
    if (record.bankingInformation === null) return null;
    const discovery: FintsDiscovery = describeStoredBankingInformation(
      record.bankingInformation,
      record.settings.tanMethod,
    );
    return this.toDiscoverDone(discovery);
  }

  /** Every connection's sync state, ordered by name. */
  async status(): Promise<SyncConnectionStatus[]> {
    const connections: BankConnection[] = await listBankConnections();
    const runs: Map<number, SyncRun> = await listLatestSyncRuns();
    return connections.map((connection: BankConnection): SyncConnectionStatus => ({
      id: connection.id,
      name: connection.name,
      enabled: connection.enabled,
      pausedReason: connection.pausedReason,
      lastSyncAt: connection.lastSyncAt,
      lastStatus: connection.lastStatus,
      lastError: connection.lastError,
      latestRun: runs.get(connection.id) ?? null,
      challenge: this.deps.registry.openChallengeOfConnection(connection.id),
    }));
  }

  /**
   * Deletes a connection with its mapping and runs, under the connection's lock so it never pulls
   * the rows from under a running sync or discovery. Whether it existed; `ConflictError` while a
   * run holds the lock.
   */
  async deleteConnection(connectionId: number): Promise<boolean> {
    const lock: PoolConnection = await this.lock(connectionId);
    try {
      return await deleteBankConnection(connectionId);
    } finally {
      await this.unlock(lock, connectionId);
    }
  }

  /** Takes the lock, reads the connection and inserts the run row; releases the lock on failure. */
  private async begin(
    connectionId: number,
    trigger: SyncTrigger,
  ): Promise<{ lock: PoolConnection; record: BankConnectionRecord; runId: number }> {
    const lock: PoolConnection = await this.lock(connectionId);
    try {
      const record: BankConnectionRecord | null = await getBankConnectionRecord(connectionId);
      if (record === null) throw new NotFoundError(`Bank connection ${connectionId}`);
      if (trigger === 'manual') await setBankConnectionPaused(connectionId, null);
      const runId: number = await createSyncRun(connectionId, trigger);
      return { lock, record, runId };
    } catch (error: unknown) {
      await this.unlock(lock, connectionId);
      throw error;
    }
  }

  private async lock(connectionId: number): Promise<PoolConnection> {
    const connection: PoolConnection = await getPool().getConnection();
    try {
      const [rows] = await connection.query<LockRow[]>('SELECT GET_LOCK(?, 0) AS acquired', [
        lockName(connectionId),
      ]);
      const acquired: number | null | undefined = rows[0]?.acquired;
      if (acquired === 0) throw new ConflictError(connectionId);
      if (acquired !== 1) throw new Error(`GET_LOCK for connection ${connectionId} failed`);
      return connection;
    } catch (error: unknown) {
      connection.release();
      throw error;
    }
  }

  /** Releases the lock; a connection whose release failed is destroyed, which frees the lock. */
  private async unlock(connection: PoolConnection, connectionId: number): Promise<void> {
    try {
      await connection.query('SELECT RELEASE_LOCK(?)', [lockName(connectionId)]);
    } catch (error: unknown) {
      connection.destroy();
      throw error;
    }
    connection.release();
  }

  private async executeSync(context: RunContext): Promise<void> {
    const totals: { inserted: number; deleted: number } = { inserted: 0, deleted: 0 };
    await this.recordFailures(context, totals, async (): Promise<void> => {
      const session: FintsSession = await this.openSession(context);
      const accounts: BankConnectionAccount[] = context.record.accounts.filter(
        (account: BankConnectionAccount) => account.enabled,
      );
      for (const account of accounts) {
        const result: MergeResult = await this.syncAccount(context, { session, account });
        totals.inserted += result.inserted;
        totals.deleted += result.deleted;
      }
      await finishSyncRun(context.runId, { status: 'success', error: null, ...totals });
      await recordBankConnectionOutcome(context.record.id, { status: 'success', error: null });
    });
  }

  private async executeDiscover(context: RunContext): Promise<DiscoverDone> {
    const totals: { inserted: number; deleted: number } = { inserted: 0, deleted: 0 };
    return this.recordFailures(context, totals, async (): Promise<DiscoverDone> => {
      const session: FintsSession = await this.openSession(context);
      const done: DiscoverDone = await this.toDiscoverDone(await session.discover());
      await finishSyncRun(context.runId, { status: 'success', error: null, ...totals });
      return done;
    });
  }

  /**
   * Runs `work`; when it throws, records the run as `error` (or `tan_expired`), a sync's outcome on
   * the connection, pauses the connection when a scheduled run's TAN expired, and throws a
   * `SyncRunError` with the PIN masked.
   */
  private async recordFailures<T>(
    context: RunContext,
    totals: { inserted: number; deleted: number },
    work: () => Promise<T>,
  ): Promise<T> {
    try {
      return await work();
    } catch (error: unknown) {
      const pin: string = this.deps.crypto.decrypt(context.record.pin);
      const status: SyncRunStatus = error instanceof TanTimeoutError ? 'tan_expired' : 'error';
      const message: string = redact(messageOf(error), pin);
      try {
        await finishSyncRun(context.runId, { status, error: message, ...totals });
        if (context.trigger !== 'discover') {
          await recordBankConnectionOutcome(context.record.id, { status, error: message });
        }
        if (status === 'tan_expired' && context.trigger === 'scheduled') {
          await setBankConnectionPaused(context.record.id, 'tan');
        }
      } catch (recordError: unknown) {
        throw new SyncRunError(
          context.runId,
          redact(`${message}; recording the failure failed too: ${messageOf(recordError)}`, pin),
        );
      }
      throw new SyncRunError(context.runId, message);
    } finally {
      this.deps.registry.release(context.runId);
    }
  }

  private async openSession(context: RunContext): Promise<FintsSession> {
    const { record } = context;
    return this.deps.sessions({
      login: {
        blz: record.settings.blz,
        fintsUrl: record.settings.fintsUrl,
        loginName: record.settings.loginName,
        customerId: record.settings.customerId,
        pin: this.deps.crypto.decrypt(record.pin),
        tanMethod: record.settings.tanMethod,
        tanMedia: record.settings.tanMedia,
        bankingInformation: record.bankingInformation,
      },
      prompt: this.trackedPrompt(context),
      saveBankingInformation: (json: string): Promise<void> =>
        saveBankingInformation(record.id, json),
    });
  }

  /** The registry's prompt, also mirroring "waiting for a TAN" into the run row. */
  private trackedPrompt(context: RunContext): TanPrompt {
    const inner: TanPrompt = this.deps.registry.createPrompt({
      runId: context.runId,
      connectionId: context.record.id,
    });
    let waiting = false;
    return {
      request: async (challenge: PendingChallenge): Promise<string | undefined> => {
        // Register first, so the challenge is answerable before anyone hears of it.
        const answer: Promise<string | undefined> = inner.request(challenge);
        // Awaited below; this only keeps an early timeout from counting as unhandled meanwhile.
        answer.catch((): void => undefined);
        context.onChallenge?.(challenge);
        if (!waiting) {
          waiting = true;
          await setSyncRunWaiting(context.runId, true);
        }
        const tan: string | undefined = await answer;
        if (challenge.kind !== 'decoupled') {
          waiting = false;
          await setSyncRunWaiting(context.runId, false);
        }
        return tan;
      },
      settled: async (): Promise<void> => {
        await inner.settled();
        if (waiting) {
          waiting = false;
          await setSyncRunWaiting(context.runId, false);
        }
      },
    };
  }

  private async syncAccount(
    context: RunContext,
    target: { readonly session: FintsSession; readonly account: BankConnectionAccount },
  ): Promise<MergeResult> {
    const { session, account } = target;
    const today: Date = localDay(new Date(), 0);
    const from: Date = await this.fetchStart(context.lock, account.kontoId);
    const bookings: FetchedBooking[] = await session.fetchStatements({
      accountIdentifier: account.accountIdentifier,
      from,
      to: today,
    });
    const balance: StatementBalance | null = await session.fetchBalance(account.accountIdentifier);
    await context.lock.beginTransaction();
    try {
      const result: MergeResult = await mergeStatement(context.lock, {
        kontoId: account.kontoId,
        bookings,
        balance,
      });
      await context.lock.commit();
      return result;
    } catch (error: unknown) {
      await context.lock.rollback();
      throw error;
    }
  }

  /** The newest booked row's date minus the overlap, or the initial window without rows. */
  private async fetchStart(connection: PoolConnection, kontoId: number): Promise<Date> {
    const [rows] = await connection.query<LatestDateRow[]>(
      `SELECT DATE_FORMAT(MAX(datum), '%Y-%m-%d') AS latest FROM umsatz
       WHERE konto_id = ? AND (COALESCE(flags, 0) & 2) = 0`,
      [kontoId],
    );
    const latest: string | null = rows[0]?.latest ?? null;
    if (latest === null) return localDay(new Date(), -INITIAL_DAYS);
    const [year, month, day] = latest.split('-').map(Number) as [number, number, number];
    return new Date(year, month - 1, day - OVERLAP_DAYS);
  }

  private async toDiscoverDone(discovery: FintsDiscovery): Promise<DiscoverDone> {
    const kontos: KontoMatchKey[] = await listKontoMatchKeys();
    return {
      status: 'done',
      tanMethods: discovery.tanMethods,
      selectedTanMethod: discovery.selectedTanMethod,
      tanMedia: discovery.tanMedia,
      accounts: discovery.accounts.map(
        (account: Omit<DiscoveredAccount, 'kontoId'>): DiscoveredAccount => ({
          ...account,
          kontoId: matchKonto(account, kontos),
        }),
      ),
    };
  }
}
