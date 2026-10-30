import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { KeyMode, UserKeyStatus } from '@hibiscus-frontend/shared/contracts/user';
import type { TranslationKey } from '../../../core/models/translation.model';
import { ApiService } from '../../../core/services/api.service';
import { TranslationService } from '../../../core/services/translation.service';
import { userErrorOf } from '../../../core/utils/user-errors';
import { SyncStatusStore } from '../../sync/sync-status.store';
import { KeyCreateComponent } from '../../setup/key-create/key-create.component';
import {
  KeyModePickerComponent,
  keyModeTitle,
} from '../../setup/key-mode-picker/key-mode-picker.component';
import { KeyChangeSectionComponent } from './key-change-section.component';
import { KeyModeSectionComponent } from './key-mode-section.component';
import { KeyResetSectionComponent } from './key-reset-section.component';

/**
 * Settings tab: the encryption key of the bank PINs. Without a key it sets one up; with one it
 * shows the mode and lock state and offers unlock/lock, a mode switch, a key change and a reset.
 */
@Component({
  selector: 'app-encryption-key',
  templateUrl: './encryption-key.component.html',
  styleUrl: './encryption-key.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    KeyCreateComponent,
    KeyModePickerComponent,
    KeyModeSectionComponent,
    KeyChangeSectionComponent,
    KeyResetSectionComponent,
  ],
})
export class EncryptionKeyComponent {
  private readonly api = inject(ApiService);
  private readonly store = inject(SyncStatusStore);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly i18n = inject(TranslationService);

  protected readonly status = signal<UserKeyStatus | null>(null);
  protected readonly loadError = signal(false);
  /** The mode a first key is created with. */
  protected readonly newMode = signal<KeyMode>('manual');

  protected readonly unlockKey = signal('');
  protected readonly unlocking = signal(false);
  protected readonly lockBusy = signal(false);
  protected readonly unlockError = signal<TranslationKey | null>(null);

  constructor() {
    this.load();
  }

  protected modeTitle(mode: KeyMode): TranslationKey {
    return keyModeTitle(mode);
  }

  /** Reloads the status here and the one the banner and the prompts read. */
  protected reload(): void {
    this.load();
    this.store.refresh().subscribe({ error: () => undefined });
  }

  protected onUnlockKey(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) throw new Error('Expected an input event');
    this.unlockKey.set(event.target.value);
  }

  protected unlock(): void {
    const key: string = this.unlockKey().trim();
    if (key === '' || this.unlocking()) return;
    this.unlocking.set(true);
    this.unlockError.set(null);
    this.api.unlockUserKey({ key }).subscribe({
      next: (): void => {
        this.unlocking.set(false);
        this.unlockKey.set('');
        this.reload();
      },
      error: (failure: unknown): void => {
        this.unlocking.set(false);
        this.unlockError.set(
          userErrorOf(failure) === 'key-invalid' ? 'keyPrompt.invalid' : 'keyState.error',
        );
      },
    });
  }

  protected lock(): void {
    if (this.lockBusy()) return;
    this.lockBusy.set(true);
    this.unlockError.set(null);
    this.api.lockUserKey().subscribe({
      next: (): void => {
        this.lockBusy.set(false);
        this.reload();
      },
      error: (): void => {
        this.lockBusy.set(false);
        this.unlockError.set('keyState.error');
      },
    });
  }

  private load(): void {
    this.api
      .getUserKey()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (status: UserKeyStatus): void => {
          this.status.set(status);
          this.loadError.set(false);
        },
        error: (): void => this.loadError.set(true),
      });
  }
}
