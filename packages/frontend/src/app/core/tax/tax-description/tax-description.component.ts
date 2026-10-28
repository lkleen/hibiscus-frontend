import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { TranslationService } from '../../services/translation.service';
import type { TaxDescription } from '../tax-i18n';

/**
 * The explanation of one tax choice: what belongs there, what does not, and the form. Used as the
 * tooltip of the section picker and as the description under the section list. The
 * host carries the `id` that the described control points to with `aria-describedby`.
 */
@Component({
  selector: 'app-tax-description',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="tax-description__text">{{ description().text }}</p>
    @if (description().excludes; as excludes) {
      <p class="tax-description__excludes">
        <span class="tax-description__label">{{ i18n.t('tax.picker.notIncluded') }}</span>
        {{ excludes }}
      </p>
    }
    @if (description().receipts; as receipts) {
      <p class="tax-description__receipts">
        <span class="tax-description__label">{{ i18n.t('tax.description.receipts') }}</span>
        {{ receipts }}
      </p>
    }
    @if (description().note; as note) {
      <p class="tax-description__note">{{ note }}</p>
    }
    @if (description().form; as form) {
      <p class="tax-description__form">{{ i18n.t('tax.picker.form', { form }) }}</p>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      min-width: 0;
      font-size: var(--text-sm);
    }

    p {
      margin: 0;
    }

    .tax-description__label {
      font-weight: 600;
    }

    .tax-description__excludes,
    .tax-description__receipts,
    .tax-description__note,
    .tax-description__form {
      color: var(--text-muted);
      font-size: var(--text-xs);
    }
  `,
})
export class TaxDescriptionComponent {
  protected readonly i18n = inject(TranslationService);

  readonly description = input.required<TaxDescription>();
}
