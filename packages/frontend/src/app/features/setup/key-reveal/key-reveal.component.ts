import { Clipboard } from '@angular/cdk/clipboard';
import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { TranslationService } from '../../../core/services/translation.service';

/**
 * Shows a newly generated key exactly once: in a read-only field with a copy button and a warning.
 * `acknowledged` only emits after the user ticked "I saved it", and the key is dropped by the
 * parent right after.
 */
@Component({
  selector: 'app-key-reveal',
  templateUrl: './key-reveal.component.html',
  styleUrl: './key-reveal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KeyRevealComponent {
  private readonly clipboard = inject(Clipboard);
  protected readonly i18n = inject(TranslationService);

  readonly key = input.required<string>();
  readonly acknowledged = output<void>();

  protected readonly saved = signal(false);
  protected readonly copied = signal(false);
  protected readonly copyFailed = signal(false);

  protected copy(): void {
    const ok: boolean = this.clipboard.copy(this.key());
    this.copied.set(ok);
    this.copyFailed.set(!ok);
  }

  protected selectAll(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) throw new Error('Expected an input event');
    event.target.select();
  }

  protected onSaved(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) throw new Error('Expected an input event');
    this.saved.set(event.target.checked);
  }

  protected done(): void {
    if (this.saved()) this.acknowledged.emit();
  }
}
