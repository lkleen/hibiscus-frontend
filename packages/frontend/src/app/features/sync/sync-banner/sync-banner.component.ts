import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
  type Signal,
} from '@angular/core';
import type { SyncConnectionStatus } from '@hibiscus-frontend/shared/contracts/sync';
import { TranslationService } from '../../../core/services/translation.service';
import { userErrorOf } from '../../../core/utils/user-errors';
import { syncErrorOf } from '../sync-errors';
import { SyncStatusStore, type PendingChallenge } from '../sync-status.store';
import { TanDialogs } from '../tan-dialog/tan-dialogs';

/**
 * App-wide notice above the pages: a bank waits for a TAN, the scheduler paused because a TAN
 * expired, or the scheduled syncs wait for the user to unlock their key. Also starts the status polling for the whole app.
 */
@Component({
  selector: 'app-sync-banner',
  templateUrl: './sync-banner.component.html',
  styleUrl: './sync-banner.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SyncBannerComponent {
  private readonly store = inject(SyncStatusStore);
  private readonly tanDialogs = inject(TanDialogs);
  protected readonly i18n = inject(TranslationService);

  protected readonly challenges: Signal<readonly PendingChallenge[]> = this.store.challenges;
  protected readonly paused: Signal<readonly SyncConnectionStatus[]> = this.store.pausedConnections;
  protected readonly awaitingUnlock: Signal<boolean> = this.store.awaitingUnlock;
  protected readonly startingId = signal<number | null>(null);
  protected readonly unlocking = signal(false);
  protected readonly errorKey = signal<
    'sync.banner.locked' | 'sync.banner.startError' | 'sync.banner.keyNotConfigured' | null
  >(null);

  constructor() {
    this.store.startPolling();
    inject(DestroyRef).onDestroy((): void => this.store.stopPolling());
  }

  protected answer(pending: PendingChallenge): void {
    this.tanDialogs.open(pending.challenge.runId);
  }

  protected resume(status: SyncConnectionStatus): void {
    if (this.startingId() !== null) return;
    this.startingId.set(status.id);
    this.errorKey.set(null);
    this.store.syncNow(status.id).subscribe({
      complete: (): void => this.startingId.set(null),
      error: (failure: unknown): void => {
        this.startingId.set(null);
        this.errorKey.set(
          syncErrorOf(failure) === 'locked'
            ? 'sync.banner.locked'
            : userErrorOf(failure) === 'key-not-configured'
              ? 'sync.banner.keyNotConfigured'
              : 'sync.banner.startError',
        );
      },
    });
  }

  protected unlock(): void {
    if (this.unlocking()) return;
    this.unlocking.set(true);
    this.errorKey.set(null);
    this.store.unlock().subscribe({
      complete: (): void => this.unlocking.set(false),
      error: (): void => {
        this.unlocking.set(false);
        this.errorKey.set('sync.banner.startError');
      },
    });
  }
}
