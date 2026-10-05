import { Injectable, WritableSignal, signal } from '@angular/core';
import type { CdkPortalOutlet } from '@angular/cdk/portal';

/**
 * Lets a page own the toolbar row a data table's own controls go into. Provide it on a component
 * that renders its own filters form (e.g. a tabbed shell whose toolbar sits above the routed tab)
 * and set `outlet` to a `cdkPortalOutlet` in that form: every `<app-data-table>` below then renders
 * its tree controls (expand/collapse all) there instead of in its own filters form, so they share
 * one row with the page's filters. Without a provider, the table renders them itself.
 */
@Injectable()
export class DataTableToolbarOutlet {
  readonly outlet: WritableSignal<CdkPortalOutlet | undefined> = signal<
    CdkPortalOutlet | undefined
  >(undefined);
}
