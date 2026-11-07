import type { MergeParams, MergeResult } from './fetched-booking';

/**
 * A held per-connection sync lock. With MariaDB it is a `GET_LOCK` on a dedicated pooled
 * connection, and every statement of the run that needs the lock runs on that same connection.
 */
export interface SyncLock {
  /** The bank connection the lock is held for. */
  readonly connectionId: number;
  /**
   * Releases the lock. When releasing fails the MySQL implementation destroys the connection,
   * which frees the lock, and throws.
   */
  release(): Promise<void>;
}

/**
 * The raw database work of `SyncService`: the per-connection lock and the statement merge. The
 * service holds no SQL; MariaDB and the demo data implement this.
 */
export interface SyncDatabase {
  /**
   * Takes the lock of `connectionId` without waiting: `null` when another run, discovery or delete
   * of that connection holds it (the service answers `ConflictError`). Throws when the lock could
   * not be requested at all.
   */
  lock(connectionId: number): Promise<SyncLock | null>;
  /**
   * The `datum` (YYYY-MM-DD) of the konto's newest booked row (pending rows, flag 2, ignored), or
   * `null` when it has none. The service derives the statement's start date from it.
   */
  latestBookedDate(lock: SyncLock, kontoId: number): Promise<string | null>;
  /**
   * Merges a fetched statement into `umsatz` (and the konto's balance) in one transaction on the
   * lock's connection: committed when the merge succeeds, rolled back and rethrown when it throws.
   */
  mergeInTransaction(lock: SyncLock, params: MergeParams): Promise<MergeResult>;
}
