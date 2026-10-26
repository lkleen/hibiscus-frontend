import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  type Signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink, type ParamMap } from '@angular/router';
import type { TranslationKey } from '../../../core/models/translation.model';
import { LocaleService } from '../../../core/services/locale.service';
import { TranslationService } from '../../../core/services/translation.service';
import { StepCategoriesComponent } from '../step-categories/step-categories.component';
import { StepCheckComponent } from '../step-check/step-check.component';
import { StepResultComponent } from '../step-result/step-result.component';
import { StepUnassignedComponent } from '../step-unassigned/step-unassigned.component';
import { TaxReturnStore } from '../tax-return.store';
import { parseTaxYear } from '../tax-year';
import type { TaxStep } from './tax-step';

interface StepItem {
  readonly step: TaxStep;
  readonly labelKey: TranslationKey;
  readonly detail: string;
  readonly reachable: boolean;
}

/**
 * The wizard of one tax year (`/tax-return/:year`): a top stepper over the four steps. Until a
 * category carries a tax tag, only step ① is reachable; after that every step is. The year comes
 * from the route (the guard has validated it) and is put into the {@link TaxReturnStore} before
 * the first render.
 */
@Component({
  selector: 'app-tax-wizard',
  templateUrl: './tax-wizard.component.html',
  styleUrls: ['../tax-ui.scss', './tax-wizard.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    StepCategoriesComponent,
    StepUnassignedComponent,
    StepCheckComponent,
    StepResultComponent,
  ],
})
export class TaxWizardComponent {
  protected readonly i18n = inject(TranslationService);
  protected readonly store = inject(TaxReturnStore);
  protected readonly locale = inject(LocaleService).locale;

  protected readonly step = signal<TaxStep>(1);

  protected readonly year: Signal<number> = computed((): number => {
    const year: number | null = this.store.year();
    if (year === null) throw new Error('no tax year chosen');
    return year;
  });

  protected readonly steps: Signal<readonly StepItem[]> = computed((): readonly StepItem[] => {
    const reachable: boolean = this.store.hasTags();
    return [
      {
        step: 1,
        labelKey: 'tax.step.categories',
        detail: this.i18n.t('tax.step.categoriesDetail'),
        reachable: true,
      },
      {
        step: 2,
        labelKey: 'tax.step.unassigned',
        detail: this.i18n.t('tax.step.unassignedDetail', {
          count: this.store.unassignedRows().length,
        }),
        reachable,
      },
      {
        step: 3,
        labelKey: 'tax.step.check',
        detail: this.i18n.t('tax.step.checkDetail', { count: this.store.openItems() }),
        reachable,
      },
      {
        step: 4,
        labelKey: 'tax.step.result',
        detail: this.i18n.t('tax.step.resultDetail'),
        reachable,
      },
    ];
  });

  constructor() {
    // Synchronous on subscribe, so the year is set before the template first renders; a later
    // emission (another year, same component) restarts at step ①.
    inject(ActivatedRoute)
      .paramMap.pipe(takeUntilDestroyed())
      .subscribe((params: ParamMap): void => {
        const year: number | null = parseTaxYear(params.get('year'));
        if (year === null) throw new Error(`invalid tax year ${params.get('year')}`);
        if (this.store.year() !== year) this.step.set(1);
        this.store.year.set(year);
      });
  }

  protected go(step: TaxStep): void {
    const target: StepItem | undefined = this.steps().find((s: StepItem) => s.step === step);
    if (target === undefined) throw new Error(`unknown step ${step}`);
    if (!target.reachable) throw new Error(`step ${step} is not reachable yet`);
    this.step.set(step);
  }
}
