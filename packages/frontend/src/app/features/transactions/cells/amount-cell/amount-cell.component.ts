import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { LocaleService } from '../../../../core/services/locale.service';

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
export class AmountCellComponent {
  protected readonly locale = inject(LocaleService).locale;

  /** `null` for a column without a value (a transaction without a balance); shown as a dash. */
  readonly amount = input<number | null>(null);

  protected readonly magnitude = computed<number>(() => Math.abs(this.amount() ?? 0));
  protected readonly isNegative = computed<boolean>(() => (this.amount() ?? 0) < 0);
  protected readonly isPositive = computed<boolean>(() => (this.amount() ?? 0) > 0);
}
