import { runWithUserContext } from '../db/pool';
import { UserBusyError } from '../db/user-activity';
import type { UserDatabaseLookup, UserPools } from '../db/user-pools';
import { listDueBankConnectionIds } from '../repositories/bank-connection';
import { ConflictError } from './sync-service';
import type { SyncService } from './sync-service';
import type { UnattendedKeyState, UserKeys } from './user-keys';

/** How often the scheduler looks for due connections. */
export const SCHEDULER_TICK_MS: number = 60 * 1000;

export interface SyncSchedulerDeps {
  readonly service: Pick<SyncService, 'runSync'>;
  readonly users: Pick<UserPools, 'listUsersWithDatabase' | 'acquire'>;
  readonly keys: Pick<UserKeys, 'unattendedState' | 'resolveUnattended'>;
}

/** Why a user's scheduled syncs are skipped; logged once per change, not on every tick. */
type SkipReason =
  Exclude<UnattendedKeyState, 'ready'> | Exclude<UserDatabaseLookup['status'], 'configured'>;

/**
 * Runs the due connections (see `listDueBankConnectionIds`) of every user with a database, every
 * tick, one user and one connection after the other; each user's work runs in that user's
 * context, on their own database, with the key the scheduler can get without the user (`stored`,
 * or `memory` while unlocked). Users in `manual` mode, locked `memory` users and users without a
 * usable database are skipped quietly: the reason is logged once when it changes. One failing
 * user database is logged and does not stop the others. A tick
 * never starts while the previous one is still running, so a run that waits up to 15 minutes for
 * a TAN delays the others instead of overlapping them. This is the top level of a scheduled run:
 * failures are logged here (the run itself has already recorded them) and never stop the timer.
 */
export class SyncScheduler {
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private stopped = false;
  /** The last logged skip reason per user; absent while the user's syncs run. */
  private readonly skipped: Map<string, SkipReason> = new Map<string, SkipReason>();

  constructor(
    private readonly deps: SyncSchedulerDeps,
    private readonly tickMs: number,
  ) {}

  start(): void {
    if (this.timer !== null) throw new Error('The sync scheduler is already running');
    this.stopped = false;
    this.timer = setInterval((): void => {
      void this.tick();
    }, this.tickMs);
    // Never keep the process alive just for the scheduler.
    this.timer.unref();
  }

  /** Stops the timer; the running tick finishes its current connection and starts no other. */
  stop(): void {
    this.stopped = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** One tick; a no-op while the previous one is still running. */
  async tick(): Promise<void> {
    if (this.inFlight !== null) return;
    this.inFlight = this.runDue().finally((): void => {
      this.inFlight = null;
    });
    await this.inFlight;
  }

  private async runDue(): Promise<void> {
    let users: string[];
    try {
      users = await this.deps.users.listUsersWithDatabase();
    } catch (error: unknown) {
      console.error('[hibiscus-backend] Listing the users with a database failed:', error);
      return;
    }
    for (const user of users) {
      if (this.stopped) return;
      try {
        const keyState: UnattendedKeyState = await this.deps.keys.unattendedState(user);
        if (keyState !== 'ready') {
          this.noteSkipped(user, keyState);
          continue;
        }
        const lookup: UserDatabaseLookup = await this.deps.users.acquire(user);
        if (lookup.status !== 'configured') {
          this.noteSkipped(user, lookup.status);
          continue;
        }
        this.noteRunning(user);
        await runWithUserContext({ user, database: lookup.database }, () =>
          this.runDueOfCurrentUser(user),
        );
      } catch (error: unknown) {
        console.error(`[hibiscus-backend] Scheduled syncs of ${user} failed:`, error);
      }
    }
  }

  private noteSkipped(user: string, reason: SkipReason): void {
    if (this.skipped.get(user) === reason) return;
    this.skipped.set(user, reason);
    console.log(`[hibiscus-backend] Scheduled syncs of ${user} skipped: ${reason}`);
  }

  private noteRunning(user: string): void {
    if (!this.skipped.delete(user)) return;
    console.log(`[hibiscus-backend] Scheduled syncs of ${user} resumed`);
  }

  private async runDueOfCurrentUser(user: string): Promise<void> {
    let ids: number[];
    try {
      ids = await listDueBankConnectionIds();
    } catch (error: unknown) {
      console.error('[hibiscus-backend] Listing the due bank connections failed:', error);
      return;
    }
    for (const id of ids) {
      if (this.stopped) return;
      try {
        await this.deps.service.runSync({
          connectionId: id,
          trigger: 'scheduled',
          key: () => this.deps.keys.resolveUnattended(user),
        });
      } catch (error: unknown) {
        if (error instanceof ConflictError || error instanceof UserBusyError) {
          console.log(
            `[hibiscus-backend] Scheduled sync of connection ${id} skipped: ${error.message}`,
          );
        } else {
          console.error(`[hibiscus-backend] Scheduled sync of connection ${id} failed:`, error);
        }
      }
    }
  }
}
