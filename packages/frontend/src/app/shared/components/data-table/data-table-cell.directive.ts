import { Directive, TemplateRef, inject, input } from '@angular/core';

/**
 * Context handed to an `appDataTableCell` template — ag-Grid's `ICellRendererParams`, minimal:
 * the raw row (never the column-accessor proxy — see `column-accessor-proxy.ts`), the column's
 * `valueGetter` result, and that same value already run through `valueFormatter`.
 */
export interface DataTableCellContext<Row> {
  readonly $implicit: Row;
  readonly value: unknown;
  readonly valueFormatted: string;
}

/**
 * Marks an `<ng-template>` as a named cell renderer a `DataTableColDef.cellRenderer` can refer to
 * by name, e.g.:
 *
 * ```html
 * <app-data-table [columns]="columns()" ...>
 *   <ng-template appDataTableCell="amount" let-row let-value="value">
 *     <app-transaction-amount-cell [amount]="toAmount(value)" />
 *   </ng-template>
 * </app-data-table>
 * ```
 *
 * `value` (`DataTableCellContext.value`) is deliberately typed `unknown`: the directive has no way
 * to know, for a given template, which column's `Value` it will end up bound to (that's the whole
 * point of naming templates by `cellRenderer` instead of writing one bespoke template per column),
 * so it cannot type it any more precisely without lying. The consumer narrows it in its own
 * component, with a function that **throws** on a value the column shouldn't be able to produce —
 * fail loudly rather than silently coerce, per this project's error-handling convention:
 *
 * ```ts
 * protected toAmount(value: unknown): number | null {
 *   if (value === null || typeof value === 'number') return value;
 *   throw new Error(`amount cell: expected a number or null, got ${typeof value}`);
 * }
 * ```
 */
@Directive({ selector: 'ng-template[appDataTableCell]' })
export class DataTableCellDirective<Row> {
  readonly appDataTableCell = input.required<string>();

  /** The directive's own template, read by the data-table component's `contentChildren` query. */
  readonly templateRef = inject<TemplateRef<DataTableCellContext<Row>>>(TemplateRef);

  static ngTemplateContextGuard<Row>(
    _directive: DataTableCellDirective<Row>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- part of the type guard signature
    context: unknown,
  ): context is DataTableCellContext<Row> {
    return true;
  }
}
