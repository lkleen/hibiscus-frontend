import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { TranslationService } from '../../../core/services/translation.service';

/**
 * "N selected" and a Clear selection button, shown in the ribbon's contextual Selection band
 * (each table registers that band while rows are ticked).
 */
@Component({
  selector: 'app-transactions-selection-bar',
  templateUrl: './transactions-selection-bar.component.html',
  styleUrl: './transactions-selection-bar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TransactionsSelectionBarComponent {
  protected readonly i18n = inject(TranslationService);
  readonly count = input.required<number>();
  readonly cleared = output<void>();
}
