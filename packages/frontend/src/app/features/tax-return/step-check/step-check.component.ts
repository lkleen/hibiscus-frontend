import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  type Signal,
} from '@angular/core';
import { Router } from '@angular/router';
import type { TranslationKey } from '../../../core/models/translation.model';
import { LocaleService } from '../../../core/services/locale.service';
import { TranslationService } from '../../../core/services/translation.service';
import { taxKey } from '../../../core/tax/tax-i18n';
import type { TaxSection } from '../../../core/tax/tax-sections';
import type { YearOverYearFinding } from '../tax-report';
import { TaxEuroPipe } from '../tax-euro.pipe';
import { TaxReturnStore, type TaxFindings } from '../tax-return.store';
import type { TaxStep } from '../wizard/tax-step';

/**
 * Step ③: what is still open before the result can be trusted — unassigned transactions,
 * tagged categories with both income and expenses, sections the life situation enables but no
 * category fills, and sections that differ strongly from the year before (computed with the
 * current tags on last year's data). Each item has a fix.
 */
@Component({
  selector: 'app-tax-step-check',
  templateUrl: './step-check.component.html',
  styleUrls: ['../tax-ui.scss', './step-check.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TaxEuroPipe],
})
export class StepCheckComponent {
  protected readonly i18n = inject(TranslationService);
  protected readonly store = inject(TaxReturnStore);
  protected readonly locale = inject(LocaleService).locale;
  private readonly router = inject(Router);

  /** Asks the wizard to show another step. */
  readonly go = output<TaxStep>();

  protected readonly findings: Signal<TaxFindings> = this.store.findings;
  protected readonly year: Signal<number> = computed((): number => this.store.report().year);

  protected nameKey(section: TaxSection): TranslationKey {
    return taxKey(section.nameKey);
  }

  protected sideKey(finding: YearOverYearFinding): TranslationKey {
    return finding.side === 'income' ? 'tax.check.sideIncome' : 'tax.check.sideExpenses';
  }

  protected openPreviousYear(): void {
    void this.router.navigate(['/', this.locale(), 'tax-return', this.year() - 1]);
  }
}
