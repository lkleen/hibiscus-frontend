import { CdkPortalOutlet } from '@angular/cdk/portal';
import {
  ChangeDetectionStrategy,
  Component,
  Signal,
  computed,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { LocaleService } from '../../core/services/locale.service';
import { TranslationService } from '../../core/services/translation.service';
import { DataTableToolbarOutlet } from '../../shared/components/data-table/data-table-toolbar-outlet';
import { DensityPickerComponent } from '../../shared/components/density-picker/density-picker.component';
import { RibbonBandDirective } from '../../shared/components/ribbon/ribbon-band.directive';
import { RibbonGroupComponent } from '../../shared/components/ribbon/ribbon-group.component';
import { RibbonHost } from '../../shared/components/ribbon/ribbon-host';
import { RibbonComponent } from '../../shared/components/ribbon/ribbon.component';
import { DateRangeFilterComponent } from '../../shared/components/date-range-filter/date-range-filter.component';
import { TabNavComponent } from '../../shared/components/tab-nav/tab-nav.component';
import { AccountFilterComponent } from './account-filter/account-filter.component';
import { CategoryDialogs } from '../categories/category-dialogs';
import { TransactionDialogs } from './transaction-dialogs';
import { TransactionsExport } from './export/transactions-export';
import { TRANSACTIONS_TABS, TransactionsTab } from './transactions-tabs';
import { TransactionsStore } from './transactions.store';

/**
 * The transactions page shell: tabs (child routes) over one shared ribbon (Filter, Period, View,
 * Export; the routed tab adds a contextual Selection band), whose View band also hosts the routed tab's
 * tree controls (via {@link DataTableToolbarOutlet}). Data and filters live
 * in the {@link TransactionsStore} provided here, so every tab sees the same loaded rows and
 * switching tabs never refetches.
 */
@Component({
  selector: 'app-transactions',
  templateUrl: './transactions.component.html',
  styleUrl: './transactions.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    TransactionsStore,
    TransactionDialogs,
    TransactionsExport,
    CategoryDialogs,
    DataTableToolbarOutlet,
    RibbonHost,
  ],
  imports: [
    CdkPortalOutlet,
    RouterOutlet,
    TabNavComponent,
    AccountFilterComponent,
    DateRangeFilterComponent,
    DensityPickerComponent,
    RibbonBandDirective,
    RibbonComponent,
    RibbonGroupComponent,
  ],
})
export class TransactionsComponent {
  protected readonly i18n = inject(TranslationService);
  protected readonly locale = inject(LocaleService).locale;
  protected readonly store = inject(TransactionsStore);
  protected readonly exporter = inject(TransactionsExport);
  protected readonly tabs: readonly TransactionsTab[] = TRANSACTIONS_TABS;
  private readonly router: Router = inject(Router);
  // Optional: the outlet only exists while the active tab has a tree.
  private readonly toolbarOutlet = viewChild(CdkPortalOutlet);

  private readonly url: Signal<string> = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event: NavigationEnd): string => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  /** The routed tab; the first (default) tab until the first navigation has finished. */
  protected readonly activeTab: Signal<TransactionsTab> = computed((): TransactionsTab => {
    const segments: string[] = this.url().split(/[?#]/)[0].split('/');
    const active: TransactionsTab | undefined = this.tabs.find((tab: TransactionsTab): boolean =>
      segments.includes(tab.path),
    );
    const fallback: TransactionsTab | undefined = this.tabs[0];
    if (!fallback) throw new Error('TRANSACTIONS_TABS must contain at least one tab');
    return active ?? fallback;
  });

  protected readonly filterActive: Signal<boolean> = computed(
    (): boolean =>
      this.store.excludedAccountIds().size > 0 || this.store.searchInput().trim() !== '',
  );

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
