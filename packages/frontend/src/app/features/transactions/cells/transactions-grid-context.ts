import type { Signal } from '@angular/core';
import type { Category } from '../../../core/models/category.model';

/**
 * What the transactions grid hands to its cell renderers through ag-Grid's `context`. Signals (not
 * plain values) so renderers, which ag-Grid creates once per cell, still react to later changes.
 */
export interface TransactionsGridContext {
  readonly categories: Signal<Category[]>;
  /** Id of the transaction whose last category update failed, if any. */
  readonly categoryUpdateErrorId: Signal<number | null>;
  readonly changeCategory: (transactionId: number, categoryId: number | null) => void;
}
