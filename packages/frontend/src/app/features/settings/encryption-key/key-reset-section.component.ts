import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { MeService } from '../../../core/services/me.service';
import { TranslationService } from '../../../core/services/translation.service';

/** For a forgotten key: deletes it together with every stored bank PIN, after a confirmation. */
@Component({
  selector: 'app-key-reset-section',
  templateUrl: './key-reset-section.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KeyResetSectionComponent {
  private readonly api = inject(ApiService);
  private readonly me = inject(MeService);
  protected readonly i18n = inject(TranslationService);

  readonly changed = output<void>();

  protected readonly confirming = signal(false);
  protected readonly working = signal(false);
  protected readonly failed = signal(false);

  protected ask(): void {
    this.confirming.set(true);
  }

  protected cancel(): void {
    this.confirming.set(false);
  }

  protected confirm(): void {
    if (this.working()) return;
    this.working.set(true);
    this.failed.set(false);
    this.api.resetUserKey().subscribe({
      next: (): void => {
        this.working.set(false);
        this.confirming.set(false);
        // The key is gone: the route guards send the user back through the setup's key steps.
        // A failed refresh is reported by `MeService.error`; the reset itself succeeded.
        this.me.refresh().subscribe({ error: (): void => undefined });
        this.changed.emit();
      },
      error: (): void => {
        this.working.set(false);
        this.failed.set(true);
      },
    });
  }
}
