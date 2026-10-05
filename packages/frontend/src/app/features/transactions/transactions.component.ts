import { CdkPortalOutlet } from '@angular/cdk/portal';
import { ChangeDetectionStrategy, Component, effect, inject, viewChild } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { LocaleService } from '../../core/services/locale.service';
import { TranslationService } from '../../core/services/translation.service';
import { DataTableToolbarOutlet } from '../../shared/components/data-table/data-table-toolbar-outlet';
import { DateRangeFilterComponent } from '../../shared/components/date-range-filter/date-range-filter.component';
import { TabNavComponent } from '../../shared/components/tab-nav/tab-nav.component';
import { AccountFilterComponent } from './account-filter/account-filter.component';
import { TRANSACTIONS_TABS, TransactionsTab } from './transactions-tabs';
import { TransactionsStore } from './transactions.store';

/**
 * The transactions page shell: tabs (child routes) over one shared toolbar, which also hosts the
 * routed tab's table controls (via {@link DataTableToolbarOutlet}). Data and filters live
 * in the {@link TransactionsStore} provided here, so every tab sees the same loaded rows and
 * switching tabs never refetches.
 */
@Component({
  selector: 'app-transactions',
  templateUrl: './transactions.component.html',
  styleUrl: './transactions.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [TransactionsStore, DataTableToolbarOutlet],
  imports: [
    CdkPortalOutlet,
    RouterOutlet,
    TabNavComponent,
    AccountFilterComponent,
    DateRangeFilterComponent,
  ],
})
export class TransactionsComponent {
  protected readonly i18n = inject(TranslationService);
  protected readonly locale = inject(LocaleService).locale;
  protected readonly store = inject(TransactionsStore);
  protected readonly tabs: readonly TransactionsTab[] = TRANSACTIONS_TABS;
  private readonly toolbarOutlet = viewChild.required(CdkPortalOutlet);

  constructor() {
    const tableToolbar: DataTableToolbarOutlet = inject(DataTableToolbarOutlet);
    effect((): void => tableToolbar.outlet.set(this.toolbarOutlet()));
  }

  protected onSearchInput(event: Event): void {
    const target: EventTarget | null = event.target;
    if (!(target instanceof HTMLInputElement)) throw new Error('expected an input event');
    this.store.searchInput.set(target.value);
  }
}
