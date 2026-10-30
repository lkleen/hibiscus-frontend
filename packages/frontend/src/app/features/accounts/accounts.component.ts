import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
  type Signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type {
  BankConnection,
  SyncConnectionStatus,
} from '@hibiscus-frontend/shared/contracts/sync';
import { accountLabel } from '../../core/utils/account-label';
import { ApiService } from '../../core/services/api.service';
import { LocaleService } from '../../core/services/locale.service';
import { TranslationService } from '../../core/services/translation.service';
import { syncErrorOf } from '../sync/sync-errors';
import { SyncStatusStore, isActiveRun } from '../sync/sync-status.store';
import { formatSyncTime } from '../sync/sync-time';

/** One connection's sync state for display. */
interface ConnectionSync {
  readonly id: number;
  readonly name: string;
  readonly lastSync: string | null;
  readonly failed: boolean;
  readonly running: boolean;
}

@Component({
  selector: 'app-accounts',
  templateUrl: './accounts.component.html',
  styleUrl: './accounts.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
})
export class AccountsComponent {
  private readonly api = inject(ApiService);
  protected readonly i18n = inject(TranslationService);
  protected readonly locale = inject(LocaleService).locale;
  private readonly destroyRef = inject(DestroyRef);

  protected readonly accountLabel: typeof accountLabel = accountLabel;
  protected readonly accounts = signal<AccountRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);

  private readonly store = inject(SyncStatusStore);
  private readonly connections = signal<readonly BankConnection[]>([]);
  protected readonly startingId = signal<number | null>(null);
  protected readonly syncErrorKey = signal<
    'accounts.sync.locked' | 'accounts.sync.startError' | null
  >(null);

  protected readonly syncs: Signal<readonly ConnectionSync[]> = computed(() =>
    (this.store.statuses() ?? []).map((status: SyncConnectionStatus): ConnectionSync => ({
      id: status.id,
      name: status.name,
      lastSync:
        status.lastSyncAt === null ? null : formatSyncTime(status.lastSyncAt, this.locale()),
      failed: status.lastStatus === 'error' || status.lastStatus === 'tan_expired',
      running: isActiveRun(status.latestRun),
    })),
  );

  /** The connection syncing each Hibiscus account, by `konto.id`. */
  private readonly syncByKonto: Signal<ReadonlyMap<number, ConnectionSync>> = computed(() => {
    const byId: ReadonlyMap<number, ConnectionSync> = new Map(
      this.syncs().map((sync: ConnectionSync): [number, ConnectionSync] => [sync.id, sync]),
    );
    const result = new Map<number, ConnectionSync>();
    for (const connection of this.connections()) {
      const sync: ConnectionSync | undefined = byId.get(connection.id);
      if (!sync) continue;
      for (const account of connection.accounts) result.set(account.kontoId, sync);
    }
    return result;
  });

  protected syncOf(account: AccountRow): ConnectionSync | undefined {
    return this.syncByKonto().get(account.id);
  }

  protected syncNow(sync: ConnectionSync): void {
    if (this.startingId() !== null) return;
    this.startingId.set(sync.id);
    this.syncErrorKey.set(null);
    this.store.syncNow(sync.id).subscribe({
      next: (): void => this.startingId.set(null),
      error: (failure: unknown): void => {
        this.startingId.set(null);
        this.syncErrorKey.set(
          syncErrorOf(failure) === 'locked' ? 'accounts.sync.locked' : 'accounts.sync.startError',
        );
      },
    });
  }

  constructor() {
    this.api
      .getBankConnections()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (connections: BankConnection[]): void => this.connections.set(connections),
        // Without the mapping the page still lists the accounts; only the per-account line is missing.
        error: (): void => this.connections.set([]),
      });
    this.store
      .refresh()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => undefined });
    this.api
      .getAccounts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (accounts) => {
          this.accounts.set(accounts);
          this.loading.set(false);
        },
        error: () => {
          this.error.set(true);
          this.loading.set(false);
        },
      });
  }
}
