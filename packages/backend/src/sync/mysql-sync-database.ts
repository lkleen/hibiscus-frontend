import { createHash } from 'node:crypto';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { UserDatabaseSettings } from '@hibiscus-frontend/shared/contracts/user';
import { currentDatabase, getPool } from '../db/pool';
import type { MergeParams, MergeResult } from './fetched-booking';
import type { SyncDatabase, SyncLock } from './sync-database';
import { mergeStatement } from './umsatz-merge';

interface LockRow extends RowDataPacket {
  acquired: number | null;
}

interface LatestDateRow extends RowDataPacket {
  latest: string | null;
}

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

/**
 * A `GET_LOCK` held on a dedicated pooled connection of the current user's database; every
 * statement of the run that needs the lock runs on that connection. The lock name is fixed when
 * the lock is taken, so the release never depends on the context it runs in.
 */
class MysqlSyncLock implements SyncLock {
  private released = false;

  constructor(
    readonly connectionId: number,
    readonly connection: PoolConnection,
    private readonly name: string,
  ) {}

  /** Releases the lock; a connection whose release failed is destroyed, which frees the lock. */
  async release(): Promise<void> {
    if (this.released) throw new Error(`The lock of connection ${this.connectionId} is released`);
    this.released = true;
    try {
      await this.connection.query('SELECT RELEASE_LOCK(?)', [this.name]);
    } catch (error: unknown) {
      this.connection.destroy();
      throw error;
    }
    this.connection.release();
  }

  /** The lock's connection; throws once the lock is released. */
  held(): PoolConnection {
    if (this.released) throw new Error(`The lock of connection ${this.connectionId} is released`);
    return this.connection;
  }
}

function asMysqlLock(lock: SyncLock): MysqlSyncLock {
  if (!(lock instanceof MysqlSyncLock)) throw new Error('The lock was not taken by MySQL');
  return lock;
}

/** `SyncDatabase` on the current user's MariaDB (`getPool()`). */
export class MysqlSyncDatabase implements SyncDatabase {
  async lock(connectionId: number): Promise<SyncLock | null> {
    const name: string = lockName(connectionId);
    const connection: PoolConnection = await getPool().getConnection();
    try {
      const [rows] = await connection.query<LockRow[]>('SELECT GET_LOCK(?, 0) AS acquired', [name]);
      const acquired: number | null | undefined = rows[0]?.acquired;
      if (acquired === 0) {
        connection.release();
        return null;
      }
      if (acquired !== 1) throw new Error(`GET_LOCK for connection ${connectionId} failed`);
      return new MysqlSyncLock(connectionId, connection, name);
    } catch (error: unknown) {
      connection.release();
      throw error;
    }
  }

  async latestBookedDate(lock: SyncLock, kontoId: number): Promise<string | null> {
    const [rows] = await asMysqlLock(lock)
      .held()
      .query<LatestDateRow[]>(
        `SELECT DATE_FORMAT(MAX(datum), '%Y-%m-%d') AS latest FROM umsatz
         WHERE konto_id = ? AND (COALESCE(flags, 0) & 2) = 0`,
        [kontoId],
      );
    return rows[0]?.latest ?? null;
  }

  async mergeInTransaction(lock: SyncLock, params: MergeParams): Promise<MergeResult> {
    const connection: PoolConnection = asMysqlLock(lock).held();
    await connection.beginTransaction();
    try {
      const result: MergeResult = await mergeStatement(connection, params);
      await connection.commit();
      return result;
    } catch (error: unknown) {
      await connection.rollback();
      throw error;
    }
  }
}
