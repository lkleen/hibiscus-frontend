import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type {
  BankConnection,
  BankConnectionAccount,
  BankConnectionSettings,
  SyncPausedReason,
} from '@hibiscus-frontend/shared/contracts/sync';
import type {
  BankConnectionCreateParams,
  BankConnectionOutcome,
  BankConnectionRecord,
  BankConnectionRepository,
  BankConnectionUpdateParams,
  BankConnectionWriteResult,
  KontoMatchKey,
  PinReencryption,
} from '../repositories/bank-connection';
import { BANK_IDENTITY_FIELDS } from '../repositories/bank-connection';
import { DuplicateKeyError, MissingReferenceError } from '../repositories/repository-errors';
import type { EncryptedSecret } from '../sync/credential-crypto';
import { compareText, formatTimestamp, nextId, parseTimestamp } from './demo-store';
import type { DemoBankConnectionAccountRow, DemoBankConnectionRow, DemoStore } from './demo-store';

/**
 * Every settings field, compared one by one like the MySQL `sameSettings`. A `Record` over the
 * keys, so a field added to `BankConnectionSettings` fails to compile here until it is listed.
 */
const SETTINGS_FIELDS: Record<keyof BankConnectionSettings, true> = {
  name: true,
  blz: true,
  fintsUrl: true,
  loginName: true,
  customerId: true,
  tanMethod: true,
  tanMedia: true,
  syncIntervalHours: true,
  enabled: true,
};

const MS_PER_HOUR = 3_600_000;

function sameSettings(a: BankConnectionSettings, b: BankConnectionSettings): boolean {
  return (Object.keys(SETTINGS_FIELDS) as (keyof BankConnectionSettings)[]).every(
    (field: keyof BankConnectionSettings) => a[field] === b[field],
  );
}

/** Only the settings fields, so extra request properties never reach the store. */
function toSettings(settings: BankConnectionSettings): BankConnectionSettings {
  return {
    name: settings.name,
    blz: settings.blz,
    fintsUrl: settings.fintsUrl,
    loginName: settings.loginName,
    customerId: settings.customerId,
    tanMethod: settings.tanMethod,
    tanMedia: settings.tanMedia,
    syncIntervalHours: settings.syncIntervalHours,
    enabled: settings.enabled,
  };
}

function toAccount(row: DemoBankConnectionAccountRow): BankConnectionAccount {
  return { accountIdentifier: row.accountIdentifier, kontoId: row.kontoId, enabled: row.enabled };
}

/**
 * `hf_bank_connection` with `hf_bank_connection_account` of the demo data.
 *
 * `reencryptPins` awaits `beforeCommit` between computing and applying the new PINs, where MySQL
 * holds row locks. Here every other write waits for a running re-encryption instead (`exclusive`),
 * so nothing can change a connection in between; reads see the old PINs until it is applied, like
 * MySQL's consistent reads.
 */
export class DemoBankConnectionRepository implements BankConnectionRepository {
  /** Settled when the running `reencryptPins` ends; `null` while none runs. */
  private pinTransaction: Promise<void> | null = null;

  constructor(private readonly store: DemoStore) {}

  /**
   * Runs `write` once no re-encryption is running. The check and `write` run in the same tick, so
   * no re-encryption can start in between.
   */
  private async exclusive<T>(write: () => T): Promise<T> {
    while (this.pinTransaction !== null) await this.pinTransaction;
    return write();
  }

  private accountsOf(connectionId: number): BankConnectionAccount[] {
    return this.store.bankConnectionAccounts
      .filter((row: DemoBankConnectionAccountRow) => row.connectionId === connectionId)
      .sort((a: DemoBankConnectionAccountRow, b: DemoBankConnectionAccountRow): number =>
        compareText(a.accountIdentifier, b.accountIdentifier),
      )
      .map(toAccount);
  }

  private toConnection(row: DemoBankConnectionRow): BankConnection {
    return {
      id: row.id,
      ...row.settings,
      accounts: this.accountsOf(row.id),
      pausedReason: row.pausedReason,
      lastSyncAt: row.lastSyncAt,
      lastStatus: row.lastStatus,
      lastError: row.lastError,
    };
  }

  /** Replaces a row by id with `change` applied; an unknown id changes nothing, like `UPDATE`. */
  private patch(id: number, change: Partial<DemoBankConnectionRow>): void {
    const row: DemoBankConnectionRow | undefined = this.store.bankConnections.get(id);
    if (row !== undefined) this.store.bankConnections.set(id, { ...row, ...change, id });
  }

  async list(): Promise<BankConnection[]> {
    return [...this.store.bankConnections.values()]
      .sort(
        (a: DemoBankConnectionRow, b: DemoBankConnectionRow): number =>
          compareText(a.settings.name, b.settings.name) || a.id - b.id,
      )
      .map((row: DemoBankConnectionRow) => this.toConnection(row));
  }

  async get(id: number): Promise<BankConnection | null> {
    const row: DemoBankConnectionRow | undefined = this.store.bankConnections.get(id);
    return row === undefined ? null : this.toConnection(row);
  }

  async getRecord(id: number): Promise<BankConnectionRecord | null> {
    const row: DemoBankConnectionRow | undefined = this.store.bankConnections.get(id);
    if (row === undefined) return null;
    return {
      id: row.id,
      settings: { ...row.settings },
      pin: row.pin,
      bankingInformation: row.bankingInformation,
      accounts: this.accountsOf(id),
    };
  }

  async create(params: BankConnectionCreateParams): Promise<number> {
    return this.exclusive((): number => {
      const id: number = nextId(this.store.bankConnections.keys());
      this.store.bankConnections.set(id, {
        id,
        settings: toSettings(params.settings),
        pin: params.pin,
        bankingInformation: null,
        pausedReason: null,
        lastSyncAt: null,
        lastStatus: null,
        lastError: null,
      });
      return id;
    });
  }

  async update(params: BankConnectionUpdateParams): Promise<BankConnectionWriteResult> {
    return this.exclusive((): BankConnectionWriteResult => {
      const row: DemoBankConnectionRow | undefined = this.store.bankConnections.get(params.id);
      if (row === undefined) return 'not-found';
      if (!sameSettings(row.settings, params.expected)) return 'conflict';
      const identityChanged: boolean = BANK_IDENTITY_FIELDS.some(
        (field: keyof BankConnectionSettings) => params.expected[field] !== params.next[field],
      );
      this.patch(params.id, {
        settings: toSettings(params.next),
        ...(params.pin === undefined ? {} : { pin: params.pin }),
        ...(identityChanged ? { bankingInformation: null } : {}),
      });
      return 'updated';
    });
  }

  /** Deletes the connection; its account mapping and runs go with it (`ON DELETE CASCADE`). */
  async delete(id: number): Promise<boolean> {
    return this.exclusive((): boolean => {
      if (!this.store.bankConnections.delete(id)) return false;
      this.store.bankConnectionAccounts = this.store.bankConnectionAccounts.filter(
        (row: DemoBankConnectionAccountRow) => row.connectionId !== id,
      );
      for (const run of [...this.store.syncRuns.values()]) {
        if (run.connectionId === id) this.store.syncRuns.delete(run.id);
      }
      return true;
    });
  }

  /**
   * Replaces the whole mapping, all or nothing: an unknown `kontoId` throws `MissingReferenceError`
   * (`konto`), a repeated account identifier `DuplicateKeyError` (the primary key).
   */
  async replaceAccounts(
    id: number,
    accounts: readonly BankConnectionAccount[],
  ): Promise<'updated' | 'not-found'> {
    return this.exclusive((): 'updated' | 'not-found' => {
      if (!this.store.bankConnections.has(id)) return 'not-found';
      const kontoIds: Set<number> = new Set<number>(
        this.store.accounts.map((account: AccountRow) => account.id),
      );
      const identifiers: Set<string> = new Set<string>();
      for (const account of accounts) {
        if (!kontoIds.has(account.kontoId)) throw new MissingReferenceError('konto');
        if (identifiers.has(account.accountIdentifier)) {
          throw new DuplicateKeyError(`Account ${account.accountIdentifier}`);
        }
        identifiers.add(account.accountIdentifier);
      }
      this.store.bankConnectionAccounts = [
        ...this.store.bankConnectionAccounts.filter(
          (row: DemoBankConnectionAccountRow) => row.connectionId !== id,
        ),
        ...accounts.map((account: BankConnectionAccount): DemoBankConnectionAccountRow => ({
          connectionId: id,
          accountIdentifier: account.accountIdentifier,
          kontoId: account.kontoId,
          enabled: account.enabled,
        })),
      ];
      return 'updated';
    });
  }

  async saveBankingInformation(id: number, json: string): Promise<void> {
    await this.exclusive((): void => this.patch(id, { bankingInformation: json }));
  }

  async recordOutcome(id: number, outcome: BankConnectionOutcome): Promise<void> {
    await this.exclusive((): void =>
      this.patch(id, {
        lastSyncAt: formatTimestamp(new Date()),
        lastStatus: outcome.status,
        lastError: outcome.error,
      }),
    );
  }

  async setPaused(id: number, reason: SyncPausedReason | null): Promise<void> {
    await this.exclusive((): void => this.patch(id, { pausedReason: reason }));
  }

  /**
   * Enabled, not paused, with a PIN, and never synced or last synced at least
   * `syncIntervalHours` ago; ordered by id.
   */
  async listDueIds(): Promise<number[]> {
    const now: number = Date.now();
    return [...this.store.bankConnections.values()]
      .filter(
        (row: DemoBankConnectionRow) =>
          row.settings.enabled &&
          row.pausedReason === null &&
          row.pin !== null &&
          (row.lastSyncAt === null ||
            parseTimestamp(row.lastSyncAt).getTime() +
              row.settings.syncIntervalHours * MS_PER_HOUR <=
              now),
      )
      .map((row: DemoBankConnectionRow) => row.id)
      .sort((a: number, b: number): number => a - b);
  }

  /**
   * All PINs or none: every new PIN is computed first, then `beforeCommit` runs, and only when both
   * succeeded are the PINs replaced. Other writes wait meanwhile (see the class comment).
   */
  async reencryptPins(params: PinReencryption): Promise<number> {
    while (this.pinTransaction !== null) await this.pinTransaction;
    // `reencryptNow` runs synchronously up to `beforeCommit`, so `pinTransaction` is set before any
    // other write can run. Waiting writers only need to know when it ended; its outcome reaches the
    // caller through `await work`.
    const work: Promise<number> = this.reencryptNow(params);
    this.pinTransaction = work.then(
      (): void => undefined,
      (): void => undefined,
    );
    try {
      return await work;
    } finally {
      this.pinTransaction = null;
    }
  }

  private async reencryptNow(params: PinReencryption): Promise<number> {
    const next: Map<number, EncryptedSecret> = new Map<number, EncryptedSecret>();
    const rows: DemoBankConnectionRow[] = [...this.store.bankConnections.values()].sort(
      (a: DemoBankConnectionRow, b: DemoBankConnectionRow): number => a.id - b.id,
    );
    for (const row of rows) {
      if (row.pin !== null) next.set(row.id, params.reencrypt(row.pin));
    }
    await params.beforeCommit();
    for (const [id, pin] of next) this.patch(id, { pin });
    return next.size;
  }

  /** Every connection loses its PIN and is disabled; returns how many there are. */
  async clearPins(): Promise<number> {
    return this.exclusive((): number => {
      for (const row of [...this.store.bankConnections.values()]) {
        this.patch(row.id, { pin: null, settings: { ...row.settings, enabled: false } });
      }
      return this.store.bankConnections.size;
    });
  }

  async listKontoMatchKeys(): Promise<KontoMatchKey[]> {
    return [...this.store.accounts]
      .sort((a: AccountRow, b: AccountRow): number => a.id - b.id)
      .map((account: AccountRow): KontoMatchKey => ({
        id: account.id,
        iban: account.iban,
        kontonummer: account.kontonummer,
      }));
  }
}
