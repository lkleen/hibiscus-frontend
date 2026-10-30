import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  type Signal,
  type WritableSignal,
} from '@angular/core';
import type {
  KeyMode,
  UserKeyModeRequest,
  UserKeyStatus,
} from '@hibiscus-frontend/shared/contracts/user';
import type { TranslationKey } from '../../../core/models/translation.model';
import { ApiService } from '../../../core/services/api.service';
import { TranslationService } from '../../../core/services/translation.service';
import { userErrorOf } from '../../../core/utils/user-errors';
import { KeyModePickerComponent } from '../../setup/key-mode-picker/key-mode-picker.component';

/** Switches the key mode. Moving to `stored` needs the key once; moving away from it deletes the stored copy. */
@Component({
  selector: 'app-key-mode-section',
  templateUrl: './key-mode-section.component.html',
  imports: [KeyModePickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KeyModeSectionComponent {
  private readonly api = inject(ApiService);
  protected readonly i18n = inject(TranslationService);

  readonly status = input.required<UserKeyStatus>();
  readonly changed = output<void>();

  protected readonly selected: WritableSignal<KeyMode> = linkedSignal(
    () => this.status().mode ?? 'manual',
  );
  protected readonly key = signal('');
  protected readonly working = signal(false);
  protected readonly error = signal<TranslationKey | null>(null);
  protected readonly saved = signal(false);

  protected readonly needsKey: Signal<boolean> = computed(
    () => this.selected() === 'stored' && this.status().mode !== 'stored',
  );
  protected readonly unchanged: Signal<boolean> = computed(
    () => this.selected() === this.status().mode,
  );

  protected onKey(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) throw new Error('Expected an input event');
    this.key.set(event.target.value);
  }

  protected save(): void {
    if (this.working() || this.unchanged()) return;
    const key: string = this.key().trim();
    if (this.needsKey() && key === '') {
      this.error.set('keyMode.error.keyRequired');
      return;
    }
    const request: UserKeyModeRequest = this.needsKey()
      ? { mode: this.selected(), key }
      : { mode: this.selected() };
    this.working.set(true);
    this.error.set(null);
    this.saved.set(false);
    this.api.setUserKeyMode(request).subscribe({
      next: (): void => {
        this.working.set(false);
        this.key.set('');
        this.saved.set(true);
        this.changed.emit();
      },
      error: (failure: unknown): void => {
        this.working.set(false);
        this.error.set(
          userErrorOf(failure) === 'key-invalid' ? 'keyPrompt.invalid' : 'keyMode.error.failed',
        );
      },
    });
  }
}
