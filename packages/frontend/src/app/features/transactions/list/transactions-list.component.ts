import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DataTableCellDirective } from '../../../shared/components/data-table/data-table-cell.directive';
import { DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import { AmountCellComponent } from '../cells/amount-cell/amount-cell.component';
import { TransactionsStore } from '../transactions.store';

/**
 * The transactions table over the shell's store. Sorting, column filters and paging are
 * `<app-data-table>`'s (a PrimeNG `p-table` underneath); the shared account/date/search filter
 * arrives as `externalFilter`. See the `transactions-table` skill.
 */
@Component({
  selector: 'app-transactions-list',
  templateUrl: './transactions-list.component.html',
  styleUrl: './transactions-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DataTableComponent, DataTableCellDirective, AmountCellComponent],
})
export class TransactionsListComponent {
  protected readonly store = inject(TransactionsStore);

  // `DataTableCellContext.value` is `unknown` by design — a cell renderer can be shared by columns
  // with different `Value` types, so the data-table component has no honest concrete type to hand
  // back (see the `colDef()` doc comment in `data-table.model.ts` for the same erasure). Narrowing
  // here, once, keeps the "amount" template's binding to `<app-transaction-amount-cell>` typed
  // without a template-level `$any()` cast. Fails loudly rather than defensively: the "amount"
  // renderer is only ever wired to `betrag`/`saldo`, both `number | null`, so anything else here
  // means a column was mis-wired to this renderer, not a value worth silently coercing to `null`.
  protected asAmount(value: unknown): number | null {
    if (value === null || typeof value === 'number') return value;
    throw new Error(`amount cell expects number | null, got ${typeof value}`);
  }
}
