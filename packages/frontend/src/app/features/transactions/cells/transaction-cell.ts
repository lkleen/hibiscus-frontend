import { computed, signal } from '@angular/core';
import type { Transaction } from '@hibiscus-frontend/shared/contracts/transactions';
import type { ICellRendererAngularComp } from 'ag-grid-angular';
import type { ICellRendererParams } from 'ag-grid-community';
import type { TransactionsGridContext } from './transactions-grid-context';

export type TransactionCellParams = ICellRendererParams<
  Transaction,
  unknown,
  TransactionsGridContext
>;

/**
 * Shared plumbing of the transactions grid's cell renderers. ag-Grid creates a renderer once per
 * cell and pushes new params through `agInit`/`refresh`, so the params live in a signal and the
 * subclasses derive everything from `row`/`context` — templates stay reactive under OnPush.
 */
export abstract class TransactionCell implements ICellRendererAngularComp {
  private readonly params = signal<TransactionCellParams | undefined>(undefined);

  protected readonly row = computed<Transaction>(() => {
    const data: Transaction | undefined = this.params()?.data;
    if (!data) throw new Error('transaction cell rendered without row data');
    return data;
  });

  protected readonly context = computed<TransactionsGridContext>(() => {
    const context: TransactionsGridContext | undefined = this.params()?.context;
    if (!context) throw new Error('transaction cell rendered without a grid context');
    return context;
  });

  agInit(params: TransactionCellParams): void {
    this.params.set(params);
  }

  refresh(params: TransactionCellParams): boolean {
    this.params.set(params);
    return true;
  }
}
