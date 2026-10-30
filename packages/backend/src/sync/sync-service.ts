import { createHash } from 'node:crypto';
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
import type { UserDatabaseSettings } from '@hibiscus-frontend/shared/contracts/user';
import { currentDatabase, currentUser, getPool } from '../db/pool';
import { markUserBusy, unmarkUserBusy } from '../db/user-activity';
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
import type { FetchedBooking, MergeResult, StatementBalance } from './fetched-booking';
import { describeStoredBankingInformation } from './fints-session';
import type { FintsDiscovery, FintsSession, FintsSessionFactory } from './fints-session';
import { TanTimeoutError } from './pending-tan-registry';
import type { PendingChallenge, PendingTanRegistry, TanPrompt } from './pending-tan-registry';
import { mergeStatement } from './umsatz-merge';
import { decryptPin, encodeUserKey } from './user-keys';

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

/** The connection has no PIN (after a key reset); the user has to enter it again. */
export class PinMissingError extends Error {
  constructor(connectionId: number) {
    super(
      `Bank connection ${connectionId} has no PIN since the key was reset; enter the PIN again`,
    );
    this.name = 'PinMissingError';
  }
}

/** A failed run, its message and stack with the PIN and the key masked. */
export class SyncRunError extends Error {
  constructor(runId: number, message: string) {
    super(`Run ${runId} failed: ${message}`);
    this.name = 'SyncRunError';
  }
}

export interface SyncServiceDeps {
  readonly sessions: FintsSessionFactory;
  readonly registry: PendingTanRegistry;
}

/**
 * Produces the user's key for one run (see `UserKeys.resolve`). It is called once the user is
 * marked busy, so no key change can slip in between; the run owns the returned buffer and zeroes
 * it when it ends — a TAN wait included.
 */
export type UserKeySource = () => Promise<Buffer>;

/** Parameters of `startSync` / `runSync`. */
export interface SyncStartParams {
  readonly connectionId: number;
  readonly trigger: RunTrigger;
  readonly key: UserKeySource;
}

/** Parameters of `discover`. */
export interface DiscoverParams {
  readonly connectionId: number;
  readonly key: UserKeySource;
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

/** The decrypted PIN, once the run has it; kept only to mask it in errors. */
interface RunSecrets {
  pin: string | null;
}

/** A run that holds the lock, its run row, the user's busy mark and the key. */
interface BegunRun {
  readonly user: string;
  readonly runId: number;
  readonly record: BankConnectionRecord;
  /** The pooled connection that holds `GET_LOCK` for the whole run; merges run on it too. */
  readonly lock: PoolConnection;
  /** The user's key, zeroed when the run ends. */
  readonly key: Buffer;
}

/** What a run works with while it holds the lock. */
interface RunContext extends BegunRun {
  readonly trigger: SyncTrigger;
  readonly secrets: RunSecrets;
  /** Discovery only: told about the first TAN challenge. */
  readonly onChallenge?: (challenge: PendingChallenge) => void;
}

/** Days fetched again before the newest booked row, so late bookings are not missed. */
const OVERLAP_DAYS = 10;
/** Days fetched for an account without any booked row yet. */
const INITIAL_DAYS = 90;

/**
 * `GET_LOCK` names are server-wide, so the name carries the current user's database: two users on
 * the same MariaDB with connection id 1 must not block each other. `hf_sync_` + 16 hex + `_` + id
 * stays well under MariaDB's 64-character limit.
 */
function lockName(connectionId: number): string {
  const settings: UserDatabaseSettings = currentDatabase().settings;
  const database: string = createHash('sha1')
    .update(`${settings.host}:${settings.port}/${settings.name}`)
    .digest('hex')
    .slice(0, 16);
  return `hf_sync_${database}_${connectionId}`;
}

function localDay(date: Date, offsetDays: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offsetDays);
}

/** Masks every occurrence of each secret (the PIN, the key as base64). */
function redact(text: string, secrets: readonly (string | null)[]): string {
  return secrets.reduce(
    (masked: string, secret: string | null): string =>
      secret === null || secret === '' ? masked : masked.split(secret).join('***'),
    text,
  );
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
 * (`lockName`) on a dedicated pooled connection for its whole duration, a second attempt gets a
 * `ConflictError` at once. Each run marks its user busy for its whole duration (`UserBusyError`
 * while the user's database or key is being reconfigured) and decrypts the PIN with the user's
 * key, which it zeroes when it ends.
 */
export class SyncService {
  constructor(private readonly deps: SyncServiceDeps) {}

  /**
   * Starts a sync and returns once it holds the lock and has its run row; the run itself goes on
   * in `done`. A manual run clears the connection's pause. Throws `UserBusyError`, what the key
   * source throws, `ConflictError` / `NotFoundError` — all before a run row exists.
   */
  async startSync(params: SyncStartParams): Promise<StartedRun> {
    const begun: BegunRun = await this.begin(params.connectionId, params.trigger, params.key);
    const done: Promise<void> = this.executeSync({
      ...begun,
      trigger: params.trigger,
      secrets: { pin: null },
    }).finally(() => this.end(begun));
    return { runId: begun.runId, done };
  }

  /** Starts a sync and waits for it to finish; throws what the run threw. */
  async runSync(params: SyncStartParams): Promise<void> {
    const started: StartedRun = await this.startSync(params);
    await started.done;
  }

  /**
   * Discovers TAN methods and accounts. Answers with the result, or as soon as the bank asks for a
   * TAN with the challenge; the discovery then goes on in the background and its result is read
   * later with `describeDiscovery`.
   */
  async discover(params: DiscoverParams): Promise<DiscoverResponse> {
    const begun: BegunRun = await this.begin(params.connectionId, 'discover', params.key);
    const { runId } = begun;
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
      ...begun,
      trigger: 'discover',
      secrets: { pin: null },
      onChallenge,
    }).finally(() => this.end(begun));
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

  /**
   * Marks the user busy, gets the key, takes the lock, reads the connection and inserts the run
   * row; undoes what it did (key zeroed, lock released, busy mark cleared) on failure.
   */
  private async begin(
    connectionId: number,
    trigger: SyncTrigger,
    source: UserKeySource,
  ): Promise<BegunRun> {
    const user: string = currentUser().user;
    markUserBusy(user);
    let key: Buffer | null = null;
    try {
      key = await source();
      const lock: PoolConnection = await this.lock(connectionId);
      try {
        const record: BankConnectionRecord | null = await getBankConnectionRecord(connectionId);
        if (record === null) throw new NotFoundError(`Bank connection ${connectionId}`);
        if (trigger === 'manual') await setBankConnectionPaused(connectionId, null);
        const runId: number = await createSyncRun(connectionId, trigger);
        return { user, runId, record, lock, key };
      } catch (error: unknown) {
        await this.unlock(lock, connectionId);
        throw error;
      }
    } catch (error: unknown) {
      key?.fill(0);
      unmarkUserBusy(user);
      throw error;
    }
  }

  /** Ends a begun run: zeroes the key, releases the lock, clears the busy mark. */
  private async end(run: BegunRun): Promise<void> {
    run.key.fill(0);
    try {
      await this.unlock(run.lock, run.record.id);
    } finally {
      unmarkUserBusy(run.user);
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
   * `SyncRunError` with the PIN and the key masked.
   */
  private async recordFailures<T>(
    context: RunContext,
    totals: { inserted: number; deleted: number },
    work: () => Promise<T>,
  ): Promise<T> {
    try {
      return await work();
    } catch (error: unknown) {
      const secrets: (string | null)[] = [context.secrets.pin, encodeUserKey(context.key)];
      const status: SyncRunStatus = error instanceof TanTimeoutError ? 'tan_expired' : 'error';
      const message: string = redact(messageOf(error), secrets);
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
          redact(
            `${message}; recording the failure failed too: ${messageOf(recordError)}`,
            secrets,
          ),
        );
      }
      throw new SyncRunError(context.runId, message);
    } finally {
      this.deps.registry.release(context.runId);
    }
  }

  /** Decrypts the PIN with the user's key; a connection without one fails the run. */
  private decryptPin(context: RunContext): string {
    if (context.record.pin === null) throw new PinMissingError(context.record.id);
    const pin: string = decryptPin(context.key, context.record.pin);
    context.secrets.pin = pin;
    return pin;
  }

  private async openSession(context: RunContext): Promise<FintsSession> {
    const { record } = context;
    const pin: string = this.decryptPin(context);
    return this.deps.sessions({
      login: {
        blz: record.settings.blz,
        fintsUrl: record.settings.fintsUrl,
        loginName: record.settings.loginName,
        customerId: record.settings.customerId,
        pin,
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
