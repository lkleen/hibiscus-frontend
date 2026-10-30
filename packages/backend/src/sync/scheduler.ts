import { listDueBankConnectionIds } from '../repositories/bank-connection';
import { ConflictError } from './sync-service';
import type { SyncService } from './sync-service';

/** How often the scheduler looks for due connections. */
export const SCHEDULER_TICK_MS: number = 60 * 1000;

/**
 * Runs the due connections (see `listDueBankConnectionIds`) every tick, one after the other. A tick
 * never starts while the previous one is still running, so a run that waits up to 15 minutes for
 * a TAN delays the others instead of overlapping them. This is the top level of a scheduled run:
 * failures are logged here (the run itself has already recorded them) and never stop the timer.
 */
export class SyncScheduler {
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private stopped = false;

  constructor(
    private readonly service: Pick<SyncService, 'runSync'>,
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
        await this.service.runSync(id, 'scheduled');
      } catch (error: unknown) {
        if (error instanceof ConflictError) {
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
