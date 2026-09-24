import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslationService } from '../../../../core/services/translation.service';
import { counterpartyOf, purposeOf } from '../../transaction-text';
import { TransactionCell } from '../transaction-cell';

/** Counterparty (bold) over the purpose text (muted) — one two-line cell. */
@Component({
  selector: 'app-transaction-description-cell',
  templateUrl: './description-cell.component.html',
  styleUrl: './description-cell.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DescriptionCellComponent extends TransactionCell {
  protected readonly i18n = inject(TranslationService);

  protected readonly counterparty = computed<string | null>(() => counterpartyOf(this.row()));
  protected readonly purpose = computed<string | null>(() => purposeOf(this.row()));
}
