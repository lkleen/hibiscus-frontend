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
import { syncErrorOf } from '../sync-errors';
import { SyncStatusStore, type PendingChallenge } from '../sync-status.store';
import { TanDialogs } from '../tan-dialog/tan-dialogs';

/**
 * App-wide notice above the pages: a bank waits for a TAN, or the scheduler paused because a TAN
 * expired. Also starts the status polling for the whole app.
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
  protected readonly startingId = signal<number | null>(null);
  protected readonly errorKey = signal<'sync.banner.locked' | 'sync.banner.startError' | null>(
    null,
  );

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
      next: (): void => this.startingId.set(null),
      error: (failure: unknown): void => {
        this.startingId.set(null);
        this.errorKey.set(
          syncErrorOf(failure) === 'locked' ? 'sync.banner.locked' : 'sync.banner.startError',
        );
      },
    });
  }
}
