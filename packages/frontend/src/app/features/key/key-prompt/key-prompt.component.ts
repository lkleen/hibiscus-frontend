import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { TranslationService } from '../../../core/services/translation.service';
import { userErrorOf } from '../../../core/utils/user-errors';
import { APP_DIALOG_CLASS } from '../../../shared/dialog/dialog-classes';
import type { KeyPromptData, KeyPromptResult } from './key-prompt.model';

/** The `ariaLabelledBy` target of the dialog. */
export const KEY_PROMPT_TITLE_ID = 'key-prompt-title';

/**
 * Asks for the encryption key and runs the action it was opened for. A wrong key shows an error
 * and keeps the dialog open; any other failure closes it and is handed to the caller.
 */
@Component({
  selector: 'app-key-prompt',
  templateUrl: './key-prompt.component.html',
  styleUrl: './key-prompt.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: APP_DIALOG_CLASS, '(keydown.escape)': 'cancel()' },
})
export class KeyPromptComponent {
  protected readonly data: KeyPromptData = inject<KeyPromptData>(DIALOG_DATA);
  private readonly ref: DialogRef<KeyPromptResult | undefined> =
    inject<DialogRef<KeyPromptResult | undefined>>(DialogRef);
  protected readonly i18n = inject(TranslationService);

  protected readonly titleId: string = KEY_PROMPT_TITLE_ID;
  protected readonly inputId = 'key-prompt-input';
  protected readonly key = signal('');
  protected readonly keepUnlocked = signal(true);
  protected readonly busy = signal(false);
  protected readonly invalid = signal(false);

  protected onKey(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) throw new Error('Expected an input event');
    this.key.set(event.target.value);
    this.invalid.set(false);
  }

  protected onKeep(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) throw new Error('Expected an input event');
    this.keepUnlocked.set(event.target.checked);
  }

  protected submit(): void {
    const key: string = this.key().trim();
    if (key === '' || this.busy()) return;
    this.busy.set(true);
    this.invalid.set(false);
    this.data.submit({ key, keepUnlocked: this.keepUnlocked() }).subscribe({
      next: (): void => this.ref.close({ kind: 'done' }),
      error: (failure: unknown): void => {
        if (userErrorOf(failure) === 'key-invalid') {
          this.busy.set(false);
          this.invalid.set(true);
          return;
        }
        this.ref.close({ kind: 'failed', failure });
      },
      complete: (): void => this.busy.set(false),
    });
  }

  protected cancel(): void {
    if (!this.busy()) this.ref.close(undefined);
  }
}
