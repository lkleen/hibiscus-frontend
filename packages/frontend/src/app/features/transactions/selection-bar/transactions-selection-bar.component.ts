import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { TranslationService } from '../../../core/services/translation.service';

/**
 * "N selected" and a Clear button for the table toolbar (project it with `appDataTableToolbar`;
 * the transactions shell shows it at the end of its filter row). With nothing selected it is
 * `display: none`, so it takes no space in that row until the first row is ticked.
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
