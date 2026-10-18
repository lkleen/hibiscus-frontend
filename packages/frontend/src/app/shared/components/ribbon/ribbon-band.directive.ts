import { DestroyRef, Directive, OnInit, TemplateRef, inject, input } from '@angular/core';
import { TranslationKey } from '../../../core/models/translation.model';
import { RibbonHost } from './ribbon-host';

/**
 * Contributes one band to the page's `RibbonHost`:
 * `<ng-template appRibbonBand="filter" ribbonLabelKey="ribbon.tab.filter">…</ng-template>`.
 */
@Directive({ selector: 'ng-template[appRibbonBand]' })
export class RibbonBandDirective implements OnInit {
  readonly appRibbonBand = input.required<string>();
  readonly ribbonLabelKey = input.required<TranslationKey>();
  readonly ribbonOrder = input<number>(0);
  readonly ribbonState = input<string | null>(null);
  readonly ribbonActive = input<boolean>(false);
  readonly ribbonContextual = input<boolean>(false);
  readonly ribbonShown = input<boolean>(true);

  private readonly template: TemplateRef<unknown> = inject(TemplateRef);
  private readonly host: RibbonHost = inject(RibbonHost, { optional: true }) ?? this.missingHost();
  private unregister: (() => void) | null = null;

  constructor() {
    inject(DestroyRef).onDestroy((): void => this.unregister?.());
  }

  // Required inputs are only readable after the first binding pass, so register from ngOnInit.
  ngOnInit(): void {
    this.unregister = this.host.register({
      id: this.appRibbonBand(),
      labelKey: this.ribbonLabelKey(),
      order: this.ribbonOrder,
      state: this.ribbonState,
      active: this.ribbonActive,
      contextual: this.ribbonContextual,
      shown: this.ribbonShown,
      template: this.template,
    });
  }

  private missingHost(): never {
    throw new Error('appRibbonBand needs a RibbonHost provided by the page');
  }
}
