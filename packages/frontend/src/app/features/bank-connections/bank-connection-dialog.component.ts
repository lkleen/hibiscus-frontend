import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
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
  BankConnectionSettings,
  DiscoverDone,
  DiscoverResponse,
  SyncRun,
  TanMethodOption,
  WithUserKey,
} from '@hibiscus-frontend/shared/contracts/sync';
import { Observable, switchMap, of, tap } from 'rxjs';
import type { TranslationKey } from '../../core/models/translation.model';
import { ApiService } from '../../core/services/api.service';
import { TranslationService } from '../../core/services/translation.service';
import { accountLabel } from '../../core/utils/account-label';
import { userErrorOf } from '../../core/utils/user-errors';
import { APP_DIALOG_CLASS } from '../../shared/dialog/dialog-classes';
import { KeyPrompts } from '../key/key-prompt/key-prompts';
import { syncErrorOf } from '../sync/sync-errors';
import { SyncStatusStore } from '../sync/sync-status.store';
import { TanDialogs } from '../sync/tan-dialog/tan-dialogs';
import {
  SYNC_INTERVAL_MAX_HOURS,
  SYNC_INTERVAL_MIN_HOURS,
  draftOf,
  draftProblems,
  mappingOf,
  mappingRowsOf,
  mediaFor,
  settingsOf,
  settingsOfConnection,
  withField,
  type AccountMappingRow,
  type BankConnectionDialogData,
  type BankConnectionDraft,
  type DraftField,
  type DraftProblem,
} from './bank-connection-dialog.model';

/** The `ariaLabelledBy` target of the dialog. */
export const BANK_CONNECTION_DIALOG_TITLE_ID = 'bank-connection-dialog-title';

type SaveError = 'conflict' | 'locked' | 'key-not-configured' | 'failed';

/**
 * Creates or edits one bank connection and, once it is stored, discovers the bank's accounts and
 * TAN methods and maps them to Hibiscus accounts. The dialog closes with the stored connection
 * (or `undefined` when nothing was stored).
 */
@Component({
  selector: 'app-bank-connection-dialog',
  templateUrl: './bank-connection-dialog.component.html',
  styleUrl: './bank-connection-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: APP_DIALOG_CLASS },
})
export class BankConnectionDialogComponent {
  private readonly data: BankConnectionDialogData = inject<BankConnectionDialogData>(DIALOG_DATA);
  private readonly ref: DialogRef<BankConnection | undefined> =
    inject<DialogRef<BankConnection | undefined>>(DialogRef);
  private readonly api = inject(ApiService);
  private readonly store = inject(SyncStatusStore);
  private readonly tanDialogs = inject(TanDialogs);
  private readonly prompts = inject(KeyPrompts);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly i18n = inject(TranslationService);

  protected readonly titleId: string = BANK_CONNECTION_DIALOG_TITLE_ID;
  protected readonly intervalMin: number = SYNC_INTERVAL_MIN_HOURS;
  protected readonly intervalMax: number = SYNC_INTERVAL_MAX_HOURS;
  protected readonly accountLabel: typeof accountLabel = accountLabel;

  /** The connection as stored; `null` until a new one was created. */
  protected readonly saved = signal<BankConnection | null>(this.data.connection);
  protected readonly draft = signal<BankConnectionDraft>(draftOf(this.data.connection));
  protected readonly showProblems = signal(false);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<SaveError | null>(null);

  protected readonly problems: Signal<readonly DraftProblem[]> = computed(() =>
    draftProblems(this.draft(), this.saved() === null),
  );
  protected readonly dirty: Signal<boolean> = computed(() => {
    const saved: BankConnection | null = this.saved();
    if (saved === null) return true;
    const next: BankConnectionSettings = settingsOf(this.draft(), saved);
    return (
      this.draft().pin !== '' ||
      JSON.stringify(next) !== JSON.stringify(settingsOfConnection(saved))
    );
  });

  protected readonly hibiscusAccounts = signal<readonly AccountRow[]>([]);
  protected readonly discovery = signal<DiscoverDone | null>(null);
  protected readonly discovering = signal(false);
  /** The run of a TAN-gated discovery we are waiting for. */
  protected readonly waitingRunId = signal<number | null>(null);
  protected readonly discoverError = signal<string | null>(null);
  protected readonly rows = signal<readonly AccountMappingRow[]>([]);
  protected readonly tanMethod = signal<number | null>(null);
  protected readonly tanMedia = signal<string | null>(null);
  protected readonly mappingSaving = signal(false);
  protected readonly mappingError = signal<SaveError | null>(null);
  protected readonly mappingSaved = signal(false);

  protected readonly selectedMethod: Signal<TanMethodOption | undefined> = computed(() =>
    this.discovery()?.tanMethods.find((method: TanMethodOption) => method.id === this.tanMethod()),
  );
  protected readonly canSaveMapping: Signal<boolean> = computed(() => {
    const method: TanMethodOption | undefined = this.selectedMethod();
    return (
      method !== undefined &&
      (!method.mediaRequired || this.tanMedia() !== null) &&
      !this.mappingSaving()
    );
  });

  constructor() {
    this.api
      .getAccounts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (accounts: AccountRow[]): void => this.hibiscusAccounts.set(accounts) });
  }

  protected problem(field: DraftProblem): boolean {
    return this.showProblems() && this.problems().includes(field);
  }

  protected onText(field: DraftField, event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) throw new Error('Expected an input event');
    const value: string = event.target.value;
    this.draft.update((draft: BankConnectionDraft) => withField(draft, field, value));
  }

  protected onEnabled(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) throw new Error('Expected an input event');
    const checked: boolean = event.target.checked;
    this.draft.update((draft: BankConnectionDraft) => withField(draft, 'enabled', checked));
  }

  protected saveConnection(): void {
    this.showProblems.set(true);
    if (this.problems().length > 0 || this.saving()) return;
    const saved: BankConnection | null = this.saved();
    const draft: BankConnectionDraft = this.draft();
    const settings: BankConnectionSettings = settingsOf(
      draft,
      saved ?? { tanMethod: null, tanMedia: null },
    );
    this.saving.set(true);
    this.saveError.set(null);
    const saving$: Observable<unknown> =
      saved === null
        ? this.prompts
            .run(this.store.key(), (body: WithUserKey) =>
              this.api.createBankConnection({ ...settings, pin: draft.pin, ...body }),
            )
            .pipe(
              tap((created: BankConnection): void => {
                this.saved.set(created);
                this.draft.update((current: BankConnectionDraft) => ({ ...current, pin: '' }));
              }),
            )
        : this.updateConnection(saved, settings, draft.pin);
    saving$.subscribe({
      complete: (): void => {
        this.saving.set(false);
        this.refreshStatus();
      },
      error: (failure: unknown): void => this.onSaveFailed(failure),
    });
  }

  /** A PIN change needs the key; every other change does not. */
  private updateConnection(
    saved: BankConnection,
    settings: BankConnectionSettings,
    pin: string,
  ): Observable<unknown> {
    const update = (body: WithUserKey): Observable<void> =>
      this.api.updateBankConnection(saved.id, {
        expected: settingsOfConnection(saved),
        next: settings,
        ...(pin === '' ? {} : { pin }),
        ...body,
      });
    const request$: Observable<void> =
      pin === '' ? update({}) : this.prompts.run(this.store.key(), update);
    return request$.pipe(
      tap((): void => {
        const identityChanged: boolean =
          settings.blz !== saved.blz ||
          settings.fintsUrl !== saved.fintsUrl ||
          settings.loginName !== saved.loginName ||
          settings.customerId !== saved.customerId;
        this.saved.set({ ...saved, ...settings });
        this.draft.update((current: BankConnectionDraft) => ({ ...current, pin: '' }));
        // The bank parameter data is gone; what was discovered no longer applies.
        if (identityChanged) this.discovery.set(null);
      }),
    );
  }

  protected discover(): void {
    const saved: BankConnection | null = this.saved();
    if (saved === null) throw new Error('Cannot discover before the connection is stored');
    if (this.discovering()) return;
    this.discovering.set(true);
    this.discoverError.set(null);
    let answered = false;
    this.prompts
      .run(this.store.key(), (body: WithUserKey) => this.api.discoverBankConnection(saved.id, body))
      .subscribe({
        complete: (): void => {
          // Cancelled prompt: nothing was started.
          if (!answered) this.discovering.set(false);
        },
        next: (response: DiscoverResponse): void => {
          answered = true;
          if (response.status === 'done') {
            this.discovering.set(false);
            this.applyDiscovery(response);
            return;
          }
          this.waitForTan(saved.id, response.runId);
        },
        error: (failure: unknown): void => {
          this.discovering.set(false);
          this.discoverError.set(
            this.i18n.t(
              syncErrorOf(failure) === 'locked'
                ? 'bankConnections.discover.locked'
                : userErrorOf(failure) === 'key-not-configured'
                  ? 'bankConnections.discover.keyNotConfigured'
                  : 'bankConnections.discover.failed',
            ),
          );
        },
      });
  }

  protected reopenTan(): void {
    const runId: number | null = this.waitingRunId();
    if (runId !== null) this.tanDialogs.open(runId);
  }

  protected onMethod(event: Event): void {
    if (!(event.target instanceof HTMLSelectElement)) throw new Error('Expected a select event');
    const id = Number(event.target.value);
    this.tanMethod.set(id);
    this.tanMedia.set(
      mediaFor(
        this.discovery()?.tanMethods.find((method: TanMethodOption) => method.id === id),
        this.tanMedia(),
      ),
    );
    this.mappingSaved.set(false);
  }

  protected onMedia(event: Event): void {
    if (!(event.target instanceof HTMLSelectElement)) throw new Error('Expected a select event');
    this.tanMedia.set(event.target.value);
    this.mappingSaved.set(false);
  }

  protected onKonto(identifier: string, event: Event): void {
    if (!(event.target instanceof HTMLSelectElement)) throw new Error('Expected a select event');
    const kontoId: number | null = event.target.value === '' ? null : Number(event.target.value);
    this.updateRow(identifier, { kontoId });
  }

  protected onRowEnabled(identifier: string, event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) throw new Error('Expected an input event');
    this.updateRow(identifier, { enabled: event.target.checked });
  }

  protected saveMapping(): void {
    const saved: BankConnection | null = this.saved();
    if (saved === null) throw new Error('Cannot map accounts before the connection is stored');
    const tanMethod: number | null = this.tanMethod();
    if (!this.canSaveMapping() || tanMethod === null) return;
    const tanMedia: string | null = this.tanMedia();
    const next: BankConnectionSettings = { ...settingsOfConnection(saved), tanMethod, tanMedia };
    const tanChanged: boolean = tanMethod !== saved.tanMethod || tanMedia !== saved.tanMedia;
    this.mappingSaving.set(true);
    this.mappingError.set(null);
    this.api
      .saveBankConnectionAccounts(saved.id, { accounts: mappingOf(this.rows()) })
      .pipe(
        switchMap((): Observable<void> =>
          tanChanged
            ? this.api.updateBankConnection(saved.id, {
                expected: settingsOfConnection(saved),
                next,
              })
            : of(undefined),
        ),
      )
      .subscribe({
        next: (): void => {
          this.mappingSaving.set(false);
          this.mappingSaved.set(true);
          this.saved.set({ ...saved, ...next, accounts: mappingOf(this.rows()) });
        },
        error: (failure: unknown): void => {
          this.mappingSaving.set(false);
          const code: string | null = syncErrorOf(failure);
          this.mappingError.set(
            code === 'conflict' ? 'conflict' : code === 'locked' ? 'locked' : 'failed',
          );
        },
      });
  }

  protected close(): void {
    this.ref.close(this.saved() ?? undefined);
  }

  protected errorKey(error: SaveError): TranslationKey {
    switch (error) {
      case 'conflict':
        return 'bankConnections.error.conflict';
      case 'locked':
        return 'bankConnections.error.locked';
      case 'key-not-configured':
        return 'bankConnections.error.keyNotConfigured';
      case 'failed':
        return 'bankConnections.error.failed';
    }
  }

  private onSaveFailed(failure: unknown): void {
    this.saving.set(false);
    const code: string | null = syncErrorOf(failure);
    this.saveError.set(
      code === 'conflict'
        ? 'conflict'
        : code === 'locked'
          ? 'locked'
          : userErrorOf(failure) === 'key-not-configured'
            ? 'key-not-configured'
            : 'failed',
    );
  }

  private refreshStatus(): void {
    this.store.refresh().subscribe({ error: () => undefined });
  }

  private updateRow(identifier: string, change: Partial<AccountMappingRow>): void {
    this.rows.update((rows: readonly AccountMappingRow[]) =>
      rows.map((row: AccountMappingRow) =>
        row.identifier === identifier ? { ...row, ...change } : row,
      ),
    );
    this.mappingSaved.set(false);
  }

  private applyDiscovery(done: DiscoverDone): void {
    const saved: BankConnection | null = this.saved();
    if (saved === null) throw new Error('Discovery without a stored connection');
    this.discovery.set(done);
    this.waitingRunId.set(null);
    this.rows.set(mappingRowsOf(done.accounts, saved.accounts));
    const methodId: number = saved.tanMethod ?? done.selectedTanMethod;
    const method: TanMethodOption | undefined = done.tanMethods.find(
      (option: TanMethodOption) => option.id === methodId,
    );
    this.tanMethod.set(method ? methodId : null);
    this.tanMedia.set(mediaFor(method, saved.tanMedia ?? done.tanMedia[0] ?? null));
    this.mappingSaved.set(false);
  }

  /** Opens the TAN dialog, then waits for the discovery run and reads its result. */
  private waitForTan(connectionId: number, runId: number): void {
    this.waitingRunId.set(runId);
    this.store
      .awaitRun(connectionId, runId)
      .pipe(
        switchMap((run: SyncRun): Observable<DiscoverDone | SyncRun> =>
          run.status === 'success' ? this.api.getBankConnectionDiscovery(connectionId) : of(run),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (result: DiscoverDone | SyncRun): void => {
          this.discovering.set(false);
          this.waitingRunId.set(null);
          if ('tanMethods' in result) {
            this.applyDiscovery(result);
            return;
          }
          this.discoverError.set(
            result.status === 'tan_expired'
              ? this.i18n.t('sync.tan.expired')
              : this.i18n.t('sync.tan.runFailed', { error: result.error ?? '–' }),
          );
        },
        error: (): void => {
          this.discovering.set(false);
          this.waitingRunId.set(null);
          this.discoverError.set(this.i18n.t('bankConnections.discover.failed'));
        },
      });
    const open: () => void = (): void => void this.tanDialogs.open(runId);
    this.store.refresh().subscribe({ next: open, error: open });
  }
}
