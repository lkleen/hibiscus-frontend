import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslationService } from '../../core/services/translation.service';
import { TaxTagDialogs } from '../../core/tax/tax-tag-dialog/tax-tag-dialogs';
import { CategoryDialogs } from '../categories/category-dialogs';
import { TransactionDialogs } from '../transactions/transaction-dialogs';
import { TransactionsStore } from '../transactions/transactions.store';
import { TaxReturnStore } from './tax-return.store';

/**
 * The tax-return feature shell. It provides the transactions store (data, matching, saves) and
 * the dialogs, the same way the transactions shell does, plus the {@link TaxReturnStore}; the
 * year picker and the wizard (child routes) share them, so moving between them never refetches.
 */
@Component({
  selector: 'app-tax-return',
  templateUrl: './tax-return.component.html',
  styleUrls: ['./tax-ui.scss', './tax-return.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    TransactionsStore,
    TransactionDialogs,
    CategoryDialogs,
    TaxTagDialogs,
    TaxReturnStore,
  ],
  imports: [RouterOutlet],
})
export class TaxReturnComponent {
  protected readonly i18n = inject(TranslationService);
  protected readonly store = inject(TaxReturnStore);
}
