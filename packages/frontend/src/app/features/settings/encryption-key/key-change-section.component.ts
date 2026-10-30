import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
  type Signal,
} from '@angular/core';
import type {
  UserKeyChangeRequest,
  UserKeyCreateResponse,
} from '@hibiscus-frontend/shared/contracts/user';
import type { TranslationKey } from '../../../core/models/translation.model';
import { ApiService } from '../../../core/services/api.service';
import { TranslationService } from '../../../core/services/translation.service';
import { userErrorOf } from '../../../core/utils/user-errors';
import { isKeyFormat } from '../../key/key-format';
import { KeyRevealComponent } from '../../setup/key-reveal/key-reveal.component';

/** Replaces the key: every stored PIN is re-encrypted under the new one in a single step. */
@Component({
  selector: 'app-key-change-section',
  templateUrl: './key-change-section.component.html',
  imports: [KeyRevealComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KeyChangeSectionComponent {
  private readonly api = inject(ApiService);
  protected readonly i18n = inject(TranslationService);

  readonly changed = output<void>();

  protected readonly oldKey = signal('');
  protected readonly generate = signal(true);
  protected readonly newKey = signal('');
  protected readonly showProblem = signal(false);
  protected readonly working = signal(false);
  protected readonly error = signal<TranslationKey | null>(null);
  protected readonly done = signal(false);
  /** The generated key; held only while it is shown. */
  protected readonly revealed = signal<string | null>(null);

  protected readonly newKeyValid: Signal<boolean> = computed(() => isKeyFormat(this.newKey()));

  protected onOld(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) throw new Error('Expected an input event');
    this.oldKey.set(event.target.value);
  }

  protected onNew(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) throw new Error('Expected an input event');
    this.newKey.set(event.target.value);
  }

  protected setGenerate(generate: boolean): void {
    this.generate.set(generate);
  }

  protected submit(): void {
    if (this.working()) return;
    this.showProblem.set(true);
    const oldKey: string = this.oldKey().trim();
    if (oldKey === '' || (!this.generate() && !this.newKeyValid())) return;
    const request: UserKeyChangeRequest = this.generate()
      ? { oldKey }
      : { oldKey, newKey: this.newKey().trim() };
    this.working.set(true);
    this.error.set(null);
    this.done.set(false);
    this.api.changeUserKey(request).subscribe({
      next: (response: UserKeyCreateResponse): void => {
        this.working.set(false);
        this.oldKey.set('');
        this.newKey.set('');
        this.showProblem.set(false);
        if (request.newKey === undefined) {
          this.revealed.set(response.key);
          return;
        }
        this.finish();
      },
      error: (failure: unknown): void => {
        this.working.set(false);
        this.error.set(
          userErrorOf(failure) === 'key-invalid' ? 'keyChange.oldInvalid' : 'keyChange.failed',
        );
      },
    });
  }

  protected acknowledged(): void {
    this.revealed.set(null);
    this.finish();
  }

  private finish(): void {
    this.done.set(true);
    this.changed.emit();
  }
}
