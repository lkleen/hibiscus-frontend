import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  type Signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { LocaleService } from '../../../core/services/locale.service';
import { TranslationService } from '../../../core/services/translation.service';
import { AccountFilterComponent } from '../../transactions/account-filter/account-filter.component';
import { TaxReturnStore, type TaxYearOption } from '../tax-return.store';
import { lastCalendarYear } from '../tax-year';

/**
 * Step zero of a tax return: pick the year (years that have transactions in the chosen
 * accounts, the last calendar year first if it has any) and the accounts to include. On the first
 * run — no category carries a tax tag yet — an intro says what the feature does and does not do.
 */
@Component({
  selector: 'app-tax-year-picker',
  templateUrl: './tax-year-picker.component.html',
  styleUrls: ['../tax-ui.scss', './tax-year-picker.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AccountFilterComponent],
})
export class TaxYearPickerComponent {
  protected readonly i18n = inject(TranslationService);
  protected readonly store = inject(TaxReturnStore);
  protected readonly locale = inject(LocaleService).locale;
  private readonly router = inject(Router);

  private readonly picked = signal<number | null>(null);

  /** The user's pick while it is offered, else the last calendar year, else the newest year. */
  protected readonly selected: Signal<number | null> = computed((): number | null => {
    const years: readonly TaxYearOption[] = this.store.years();
    const offered: (year: number | null) => boolean = (year: number | null): boolean =>
      year !== null && years.some((option: TaxYearOption): boolean => option.year === year);
    const picked: number | null = this.picked();
    if (offered(picked)) return picked;
    const last: number = lastCalendarYear(new Date());
    if (offered(last)) return last;
    return years[0]?.year ?? null;
  });

  protected pick(year: number): void {
    this.picked.set(year);
  }

  protected continue(): void {
    const year: number | null = this.selected();
    if (year === null) throw new Error('no year to continue with');
    void this.router.navigate(['/', this.locale(), 'tax-return', year]);
  }
}
