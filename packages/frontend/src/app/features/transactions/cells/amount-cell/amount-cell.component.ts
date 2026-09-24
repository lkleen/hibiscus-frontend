import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { LocaleService } from '../../../../core/services/locale.service';
import { TransactionCell } from '../transaction-cell';

/**
 * Renders `betrag` with both amount formats in the DOM ("signed" and "parenthesised"); the active
 * theme identity picks which one is visible (see the `_theme-*.scss` files), so the class names
 * below are a contract with the themes.
 */
@Component({
  selector: 'app-transaction-amount-cell',
  templateUrl: './amount-cell.component.html',
  styleUrl: './amount-cell.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
  host: {
    '[class.transaction-table__amount--negative]': 'amount() < 0',
    '[class.transaction-table__amount--positive]': 'amount() > 0',
  },
})
export class AmountCellComponent extends TransactionCell {
  protected readonly locale = inject(LocaleService).locale;

  protected readonly amount = computed<number>(() => this.row().betrag);
  protected readonly magnitude = computed<number>(() => Math.abs(this.amount()));
}
