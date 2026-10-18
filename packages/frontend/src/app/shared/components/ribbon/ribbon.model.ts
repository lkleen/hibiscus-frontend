import type { Signal, TemplateRef } from '@angular/core';
import type { TranslationKey } from '../../../core/models/translation.model';

/** `full`: tab strip and band. `tabs`: strip only. `hidden`: one slim line of state chips. */
export type RibbonMode = 'full' | 'tabs' | 'hidden';

export interface RibbonBand {
  readonly id: string;
  readonly labelKey: TranslationKey;
  readonly order: Signal<number>;
  /** Shown after the tab label, and as a chip in hidden mode. */
  readonly state: Signal<string | null>;
  /** A dot on the tab: this band's settings restrict the rows. */
  readonly active: Signal<boolean>;
  /** Accent-marked tab (Office "contextual tab"). */
  readonly contextual: Signal<boolean>;
  /** False: no tab at all. */
  readonly shown: Signal<boolean>;
  readonly template: TemplateRef<unknown>;
}
