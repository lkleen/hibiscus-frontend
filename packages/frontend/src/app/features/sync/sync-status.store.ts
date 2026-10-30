import { Injectable, computed, inject, signal, type Signal } from '@angular/core';
import type {
  OpenTanChallenge,
  SyncConnectionStatus,
  SyncRun,
  SyncStartResponse,
} from '@hibiscus-frontend/shared/contracts/sync';
import { Observable, filter, finalize, map, switchMap, take, tap, timer } from 'rxjs';
import { ApiService } from '../../core/services/api.service';

/** Poll interval while a run is `running` or `tan_required`. */
export const SYNC_POLL_BUSY_MS = 5_000;
/** Poll interval while nothing runs. */
export const SYNC_POLL_IDLE_MS = 60_000;
/** How often `awaitRun` re-reads the status. */
const AWAIT_RUN_POLL_MS = 2_000;

/** An open challenge with the connection it belongs to. */
export interface PendingChallenge {
  readonly connectionId: number;
  readonly connectionName: string;
  readonly challenge: OpenTanChallenge;
}

/** Whether `run` is still going (`running` or waiting for a TAN). */
export function isActiveRun(run: SyncRun | null): boolean {
  return run !== null && (run.status === 'running' || run.status === 'tan_required');
}

/** The run `runId` of connection `connectionId` once it has finished, else `null`. */
export function finishedRun(
  statuses: readonly SyncConnectionStatus[],
  connectionId: number,
  runId: number,
): SyncRun | null {
  const run: SyncRun | null =
    statuses.find((status: SyncConnectionStatus) => status.id === connectionId)?.latestRun ?? null;
  return run !== null && run.id === runId && !isActiveRun(run) ? run : null;
}

/**
 * The server-side bank sync state, shared app-wide: `GET /api/sync/status`, polled every 5 s while
 * a run is active and every 60 s otherwise, once somebody called `startPolling`. Only the
 * server's answers change the signals.
 */
@Injectable({ providedIn: 'root' })
export class SyncStatusStore {
  private readonly api = inject(ApiService);
  private readonly state = signal<readonly SyncConnectionStatus[] | null>(null);
  private polling = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private requestSeq = 0;
  private appliedSeq = 0;

  /** `null` until the first answer. */
  readonly statuses: Signal<readonly SyncConnectionStatus[] | null> = this.state.asReadonly();
  /** The last poll failed; the statuses shown are from an earlier one. */
  readonly error = signal(false);

  readonly busy: Signal<boolean> = computed(() =>
    (this.state() ?? []).some((status: SyncConnectionStatus) => isActiveRun(status.latestRun)),
  );

  readonly challenges: Signal<readonly PendingChallenge[]> = computed(() =>
    (this.state() ?? []).flatMap((status: SyncConnectionStatus): PendingChallenge[] =>
      status.challenge
        ? [
            {
              connectionId: status.id,
              connectionName: status.name,
              challenge: status.challenge,
            },
          ]
        : [],
    ),
  );

  readonly pausedConnections: Signal<readonly SyncConnectionStatus[]> = computed(() =>
    (this.state() ?? []).filter(
      (status: SyncConnectionStatus) => status.pausedReason === 'tan' && status.challenge === null,
    ),
  );

  /**
   * Fetches the status. A slower, older answer never overwrites a newer one. Errors set `error`
   * and propagate.
   */
  refresh(): Observable<readonly SyncConnectionStatus[]> {
    const seq: number = ++this.requestSeq;
    return this.api.getSyncStatus().pipe(
      tap({
        next: (statuses: SyncConnectionStatus[]): void => {
          if (seq > this.appliedSeq) {
            this.appliedSeq = seq;
            this.state.set(statuses);
          }
          this.error.set(false);
        },
        error: (): void => this.error.set(true),
      }),
      map((): readonly SyncConnectionStatus[] => this.state() ?? []),
    );
  }

  /** Starts a run; the caller sees it through the status. `409` `locked` propagates. */
  syncNow(connectionId: number): Observable<SyncStartResponse> {
    return this.api
      .syncBankConnection(connectionId)
      .pipe(tap((): void => void this.refresh().subscribe({ error: () => undefined })));
  }

  /** Emits the run once it has finished, whatever its outcome; polls every 2 s until then. */
  awaitRun(connectionId: number, runId: number): Observable<SyncRun> {
    return timer(0, AWAIT_RUN_POLL_MS).pipe(
      switchMap(() => this.refresh()),
      map((statuses: readonly SyncConnectionStatus[]) =>
        finishedRun(statuses, connectionId, runId),
      ),
      filter((run: SyncRun | null): run is SyncRun => run !== null),
      take(1),
    );
  }

  /** Reference-counted: polling runs while at least one caller has started it. */
  startPolling(): void {
    this.polling++;
    if (this.polling === 1) this.tick();
  }

  stopPolling(): void {
    if (this.polling === 0) throw new Error('stopPolling without startPolling');
    this.polling--;
    if (this.polling === 0 && this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    this.timer = null;
    this.refresh()
      .pipe(finalize((): void => this.schedule()))
      .subscribe({ error: () => undefined });
  }

  private schedule(): void {
    if (this.polling === 0 || this.timer !== null) return;
    this.timer = setTimeout(
      (): void => this.tick(),
      this.busy() ? SYNC_POLL_BUSY_MS : SYNC_POLL_IDLE_MS,
    );
  }
}
