import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Signal,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type { TaxProfile } from '@hibiscus-frontend/shared/contracts/user-settings';
import { accountLabel } from '../../core/utils/account-label';
import { ApiService } from '../../core/services/api.service';
import { TaxProfileService } from '../../core/services/tax-profile.service';
import { LocaleService } from '../../core/services/locale.service';
import { TranslationService } from '../../core/services/translation.service';

/** `Date#getMonth` of July; the hint runs until the end of it. */
const JULY = 6;

@Component({
  selector: 'app-accounts',
  templateUrl: './accounts.component.html',
  styleUrl: './accounts.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, RouterLink],
})
export class AccountsComponent {
  private readonly api = inject(ApiService);
  protected readonly i18n = inject(TranslationService);
  protected readonly locale = inject(LocaleService).locale;
  private readonly destroyRef = inject(DestroyRef);
  private readonly taxProfile = inject(TaxProfileService);
  private readonly today: Date = this.currentDate();

  /** The tax year the seasonal hint is about: the year before the current one. */
  protected readonly lastYear: number = this.today.getFullYear() - 1;

  /** From 1 January to 31 July, once the profile has loaded and this year was not dismissed. */
  protected readonly showTaxHint: Signal<boolean> = computed((): boolean => {
    const profile: TaxProfile | null = this.taxProfile.profile();
    if (!this.taxProfile.loaded() || !profile) return false;
    return this.today.getMonth() <= JULY && profile.hintDismissedYear !== this.lastYear;
  });

  protected readonly accountLabel: typeof accountLabel = accountLabel;
  protected readonly accounts = signal<AccountRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);

  constructor() {
    this.api
      .getAccounts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (accounts) => {
          this.accounts.set(accounts);
          this.loading.set(false);
        },
        error: () => {
          this.error.set(true);
          this.loading.set(false);
        },
      });
  }

  protected dismissTaxHint(): void {
    const profile: TaxProfile | null = this.taxProfile.profile();
    if (!profile) throw new Error('tax profile is not loaded');
    this.taxProfile.save({ ...profile, hintDismissedYear: this.lastYear });
  }

  /** The clock, a method so a spec can control it. */
  protected currentDate(): Date {
    return new Date();
  }
}
