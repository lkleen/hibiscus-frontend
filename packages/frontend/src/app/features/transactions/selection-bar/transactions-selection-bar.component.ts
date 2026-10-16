import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { TranslationService } from '../../../core/services/translation.service';

/**
 * "N selected" and a Clear button for the table toolbar (project it with `appDataTableToolbar`).
 * It is always rendered, so the toolbar row never appears or collapses when the first row is
 * ticked; with nothing selected its content is `visibility: hidden` (kept in the layout, out of
 * the tab order and the accessibility tree).
 */
@Component({
  selector: 'app-transactions-selection-bar',
  templateUrl: './transactions-selection-bar.component.html',
  styleUrl: './transactions-selection-bar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'filters__actions', '[class.selection-bar--idle]': 'count() === 0' },
})
export class TransactionsSelectionBarComponent {
  protected readonly i18n = inject(TranslationService);
  readonly count = input.required<number>();
  readonly cleared = output<void>();
}
