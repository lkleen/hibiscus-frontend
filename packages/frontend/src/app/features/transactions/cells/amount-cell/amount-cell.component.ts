import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { LocaleService } from '../../../../core/services/locale.service';
import { TransactionCell } from '../transaction-cell';

/**
 * Renders the cell's number (`betrag`, `saldo`) with both amount formats in the DOM ("signed" and "parenthesised"); the active
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
    '[class.transaction-table__amount--negative]': 'isNegative()',
    '[class.transaction-table__amount--positive]': 'isPositive()',
  },
})
export class AmountCellComponent extends TransactionCell {
  protected readonly locale = inject(LocaleService).locale;

  /** `null` for a column without a value (a transaction without a balance); shown as a dash. */
  protected readonly amount = computed<number | null>(() => {
    const value: unknown = this.value();
    if (value === null || value === undefined) return null;
    if (typeof value !== 'number') throw new Error('amount cell rendered a non-number');
    return value;
  });
  protected readonly magnitude = computed<number>(() => Math.abs(this.amount() ?? 0));
  protected readonly isNegative = computed<boolean>(() => (this.amount() ?? 0) < 0);
  protected readonly isPositive = computed<boolean>(() => (this.amount() ?? 0) > 0);
}
