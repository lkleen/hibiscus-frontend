import { FocusKeyManager } from '@angular/cdk/a11y';
import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Signal,
  WritableSignal,
  computed,
  inject,
  input,
  signal,
  viewChildren,
} from '@angular/core';
import { TranslationService } from '../../../core/services/translation.service';
import { RibbonHost } from './ribbon-host';
import { RibbonStateStore, RibbonViewState } from './ribbon-state.store';
import { RibbonTabDirective } from './ribbon-tab.directive';
import { RibbonBand, RibbonMode } from './ribbon.model';

/**
 * Ribbon toolbar: a tab strip switches between the bands registered on the page's `RibbonHost`;
 * the active band shows its groups below. Selection and mode live in `RibbonStateStore`.
 */
/** One chip of the hidden mode's summary line. */
interface RibbonStateChip {
  readonly id: string;
  readonly labelKey: RibbonBand['labelKey'];
  readonly state: string;
}

@Component({
  selector: 'app-ribbon',
  templateUrl: './ribbon.component.html',
  styleUrl: './ribbon.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, RibbonTabDirective],
})
export class RibbonComponent {
  protected readonly i18n: TranslationService = inject(TranslationService);
  private readonly store: RibbonStateStore = inject(RibbonStateStore);
  private readonly host: RibbonHost = inject(RibbonHost, { optional: true }) ?? this.missingHost();

  readonly ribbonId = input.required<string>();

  protected readonly bands: Signal<readonly RibbonBand[]> = this.host.bands;
  private readonly viewState: Signal<RibbonViewState> = computed((): RibbonViewState =>
    this.store.state(this.ribbonId())(),
  );
  protected readonly mode: Signal<RibbonMode> = computed((): RibbonMode => this.viewState().mode);
  /** The stored band, or the first one while none is stored or the stored one is not shown. */
  protected readonly activeBand: Signal<RibbonBand | undefined> = computed(
    (): RibbonBand | undefined => {
      const bands: readonly RibbonBand[] = this.bands();
      const activeId: string | null = this.viewState().activeId;
      return bands.find((band: RibbonBand): boolean => band.id === activeId) ?? bands[0];
    },
  );
  /** Hidden mode's chips: every band with a state, named by its tab so a bare count reads right. */
  protected readonly stateChips: Signal<readonly RibbonStateChip[]> = computed(
    (): readonly RibbonStateChip[] =>
      this.bands().flatMap((band: RibbonBand): RibbonStateChip[] => {
        const state: string | null = band.state();
        return state === null ? [] : [{ id: band.id, labelKey: band.labelKey, state }];
      }),
  );

  private readonly tabs: Signal<readonly RibbonTabDirective[]> = viewChildren(RibbonTabDirective);
  private readonly focusedIndex: WritableSignal<number | null> = signal<number | null>(null);
  /** The tab holding tabindex 0: the focused one, else the active one. */
  protected readonly tabbableId: Signal<string | undefined> = computed((): string | undefined => {
    const index: number | null = this.focusedIndex();
    return (index === null ? undefined : this.bands()[index]?.id) ?? this.activeBand()?.id;
  });

  protected panelId(band: RibbonBand): string {
    return `${this.ribbonId()}-panel-${band.id}`;
  }

  protected tabId(band: RibbonBand): string {
    return `${this.ribbonId()}-tab-${band.id}`;
  }

  protected onKeydown(event: KeyboardEvent): void {
    // Built per key press: the roving index lives in `focusedIndex`, the tabs in the query.
    const keyManager: FocusKeyManager<RibbonTabDirective> = new FocusKeyManager<RibbonTabDirective>(
      this.tabs(),
    )
      .withHorizontalOrientation('ltr')
      .withHomeAndEnd()
      .withWrap();
    const index: number | null = this.focusedIndex();
    if (index !== null) keyManager.updateActiveItem(index);
    keyManager.onKeydown(event);
    this.focusedIndex.set(keyManager.activeItemIndex);
  }

  protected onTabFocus(index: number): void {
    this.focusedIndex.set(index);
  }

  protected selectTab(band: RibbonBand): void {
    const id: string = this.ribbonId();
    if (band.id === this.activeBand()?.id) {
      this.store.setMode(id, this.mode() === 'full' ? 'tabs' : 'full');
      return;
    }
    this.store.setActive(id, band.id);
    if (this.mode() === 'tabs') this.store.setMode(id, 'full');
  }

  protected setMode(mode: RibbonMode): void {
    this.store.setMode(this.ribbonId(), mode);
  }

  private missingHost(): never {
    throw new Error('<app-ribbon> needs a RibbonHost provided by the page');
  }
}
