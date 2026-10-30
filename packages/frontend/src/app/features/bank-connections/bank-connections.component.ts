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
import type {
  BankConnection,
  SyncConnectionStatus,
} from '@hibiscus-frontend/shared/contracts/sync';
import type { TranslationKey } from '../../core/models/translation.model';
import { ApiService } from '../../core/services/api.service';
import { LocaleService } from '../../core/services/locale.service';
import { TranslationService } from '../../core/services/translation.service';
import { syncErrorOf } from '../sync/sync-errors';
import { SyncStatusStore } from '../sync/sync-status.store';
import { formatSyncTime } from '../sync/sync-time';
import { BankConnectionDialogs } from './bank-connection-dialogs';

/** A connection with the freshest sync state (the polled status wins over the loaded row). */
interface ConnectionRow {
  readonly connection: BankConnection;
  readonly paused: boolean;
  readonly lastSync: string | null;
  readonly statusKey: TranslationKey | null;
  readonly failed: boolean;
  readonly error: string | null;
}

const STATUS_KEYS: Readonly<Record<NonNullable<BankConnection['lastStatus']>, TranslationKey>> = {
  running: 'sync.status.running',
  tan_required: 'sync.status.tan_required',
  success: 'sync.status.success',
  error: 'sync.status.error',
  tan_expired: 'sync.status.tan_expired',
};

/** Settings tab: the bank connections with add, edit and delete. */
@Component({
  selector: 'app-bank-connections',
  templateUrl: './bank-connections.component.html',
  styleUrl: './bank-connections.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [BankConnectionDialogs],
})
export class BankConnectionsComponent {
  private readonly api = inject(ApiService);
  private readonly dialogs = inject(BankConnectionDialogs);
  private readonly store = inject(SyncStatusStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly locale = inject(LocaleService).locale;
  protected readonly i18n = inject(TranslationService);

  protected readonly connections = signal<readonly BankConnection[] | null>(null);
  protected readonly loadError = signal(false);
  protected readonly confirmingId = signal<number | null>(null);
  protected readonly busyId = signal<number | null>(null);
  protected readonly actionError = signal<TranslationKey | null>(null);

  protected readonly rows: Signal<readonly ConnectionRow[]> = computed(() => {
    const statuses: readonly SyncConnectionStatus[] = this.store.statuses() ?? [];
    return (this.connections() ?? []).map((connection: BankConnection): ConnectionRow => {
      const status: SyncConnectionStatus | undefined = statuses.find(
        (entry: SyncConnectionStatus) => entry.id === connection.id,
      );
      const source: Pick<
        BankConnection,
        'pausedReason' | 'lastSyncAt' | 'lastStatus' | 'lastError'
      > = status ?? connection;
      const lastSync: string | null = source.lastSyncAt;
      return {
        connection,
        paused: source.pausedReason !== null,
        lastSync: lastSync === null ? null : formatSyncTime(lastSync, this.locale()),
        statusKey: source.lastStatus === null ? null : STATUS_KEYS[source.lastStatus],
        failed: source.lastStatus === 'error' || source.lastStatus === 'tan_expired',
        error: source.lastError,
      };
    });
  });

  constructor() {
    this.load();
  }

  protected add(): void {
    this.dialogs.open(null).subscribe((): void => this.reload());
  }

  protected edit(connection: BankConnection): void {
    this.dialogs.open(connection).subscribe((): void => this.reload());
  }

  protected askDelete(connection: BankConnection): void {
    this.actionError.set(null);
    this.confirmingId.set(connection.id);
  }

  protected cancelDelete(): void {
    this.confirmingId.set(null);
  }

  protected confirmDelete(connection: BankConnection): void {
    if (this.busyId() !== null) return;
    this.busyId.set(connection.id);
    this.actionError.set(null);
    this.api.deleteBankConnection(connection.id).subscribe({
      next: (): void => {
        this.busyId.set(null);
        this.confirmingId.set(null);
        this.reload();
      },
      error: (failure: unknown): void => {
        this.busyId.set(null);
        this.actionError.set(
          syncErrorOf(failure) === 'locked'
            ? 'bankConnections.error.locked'
            : 'bankConnections.error.failed',
        );
      },
    });
  }

  private reload(): void {
    this.load();
    this.store.refresh().subscribe({ error: () => undefined });
  }

  private load(): void {
    this.api
      .getBankConnections()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (connections: BankConnection[]): void => {
          this.connections.set(connections);
          this.loadError.set(false);
        },
        error: (): void => this.loadError.set(true),
      });
  }
}
