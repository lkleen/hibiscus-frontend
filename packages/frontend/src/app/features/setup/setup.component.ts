import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { KeyMode } from '@hibiscus-frontend/shared/contracts/user';
import type { TranslationKey } from '../../core/models/translation.model';
import { MeService } from '../../core/services/me.service';
import { LocaleService } from '../../core/services/locale.service';
import { TranslationService } from '../../core/services/translation.service';
import { DatabaseFormComponent } from './database-form/database-form.component';
import { KeyCreateComponent } from './key-create/key-create.component';
import { KeyModePickerComponent } from './key-mode-picker/key-mode-picker.component';

type SetupStep = 'database' | 'mode' | 'key';

interface StepEntry {
  readonly step: SetupStep;
  readonly label: TranslationKey;
}

/**
 * First run: the user's Hibiscus database, how the server may handle their key, and the key
 * itself. The mode comes before the key because it is part of creating the key. It opens at the first unfinished step (see
 * `MeService.firstOpenStep`). The route is only reachable while the database or the key is
 * unconfigured (see `setupGuard`); the page stays open after the database was saved so the
 * remaining steps can finish.
 */
@Component({
  selector: 'app-setup',
  templateUrl: './setup.component.html',
  styleUrl: './setup.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatabaseFormComponent, KeyModePickerComponent, KeyCreateComponent],
})
export class SetupComponent {
  private readonly router = inject(Router);
  private readonly locale = inject(LocaleService).locale;
  protected readonly i18n = inject(TranslationService);

  protected readonly steps: readonly StepEntry[] = [
    { step: 'database', label: 'setup.step.database' },
    { step: 'mode', label: 'setup.step.mode' },
    { step: 'key', label: 'setup.step.key' },
  ];
  private readonly me = inject(MeService);
  protected readonly step = signal<SetupStep>(this.me.firstOpenStep());
  protected readonly mode = signal<KeyMode>('manual');

  protected indexOf(step: SetupStep): number {
    return this.steps.findIndex((entry: StepEntry) => entry.step === step);
  }

  protected go(step: SetupStep): void {
    this.step.set(step);
  }

  /** Refreshes the user first: the app pages are guarded by it and still see the key as missing. */
  protected finish(): void {
    this.me.refresh().subscribe((): void => {
      void this.router.navigateByUrl(`/${this.locale()}/accounts`);
    });
  }
}
