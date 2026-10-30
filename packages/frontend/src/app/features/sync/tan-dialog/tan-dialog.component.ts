import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  type Signal,
} from '@angular/core';
import type { TanAnswerRequest, TanChallengeKind } from '@hibiscus-frontend/shared/contracts/sync';
import { ApiService } from '../../../core/services/api.service';
import { TranslationService } from '../../../core/services/translation.service';
import { APP_DIALOG_CLASS } from '../../../shared/dialog/dialog-classes';
import { syncErrorOf } from '../sync-errors';
import { SyncStatusStore } from '../sync-status.store';
import {
  challengeImageUrl,
  tanAnswerOf,
  tanViewOf,
  type TanDialogData,
  type TanView,
} from './tan-dialog.model';

/** The `ariaLabelledBy` target of the dialog. */
export const TAN_DIALOG_TITLE_ID = 'tan-dialog-title';

/**
 * Answers the open TAN challenge of one run. The sync status decides what is shown; the dialog
 * closes by itself once the challenge is gone, and stays open to show how a run failed.
 */
@Component({
  selector: 'app-tan-dialog',
  templateUrl: './tan-dialog.component.html',
  styleUrl: './tan-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: APP_DIALOG_CLASS },
})
export class TanDialogComponent {
  private readonly data: TanDialogData = inject<TanDialogData>(DIALOG_DATA);
  private readonly ref: DialogRef<void> = inject<DialogRef<void>>(DialogRef);
  private readonly api = inject(ApiService);
  private readonly store = inject(SyncStatusStore);
  protected readonly i18n = inject(TranslationService);

  protected readonly titleId: string = TAN_DIALOG_TITLE_ID;
  protected readonly inputId = 'tan-dialog-input';
  protected readonly imageUrl: string = challengeImageUrl(this.data.runId);
  protected readonly tan = signal('');
  protected readonly busy = signal(false);
  protected readonly failed = signal(false);

  protected readonly view: Signal<TanView> = computed(() =>
    tanViewOf(this.store.statuses(), this.data.runId),
  );

  constructor() {
    effect((): void => {
      if (this.view().kind === 'done') this.ref.close();
    });
  }

  protected onInput(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) throw new Error('Expected an input event');
    this.tan.set(event.target.value);
  }

  protected canSubmit(kind: TanChallengeKind): boolean {
    return !this.busy() && tanAnswerOf(kind, this.tan()) !== null;
  }

  protected submit(kind: TanChallengeKind): void {
    const body: TanAnswerRequest | null = tanAnswerOf(kind, this.tan());
    if (body === null || this.busy()) return;
    this.busy.set(true);
    this.failed.set(false);
    this.api.answerTan(this.data.runId, body).subscribe({
      next: (): void => {
        this.busy.set(false);
        this.refreshStatus();
      },
      error: (failure: unknown): void => {
        this.busy.set(false);
        if (syncErrorOf(failure) === 'no-challenge') {
          // Nobody waits any more (answered elsewhere or expired): leave and show the truth.
          this.refreshStatus();
          this.ref.close();
          return;
        }
        this.failed.set(true);
      },
    });
  }

  protected close(): void {
    this.ref.close();
  }

  private refreshStatus(): void {
    this.store.refresh().subscribe({ error: () => undefined });
  }
}
