import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  type Signal,
} from '@angular/core';
import type { TranslationKey } from '../../../core/models/translation.model';
import { TranslationService } from '../../../core/services/translation.service';
import { TaxCodeComponent } from '../../../core/tax/tax-code/tax-code.component';
import { guidanceKey, taxKey, type TaxGuidancePart } from '../../../core/tax/tax-i18n';
import {
  TAX_EXCLUDED_CODE,
  type EffectiveTaxSection,
  type TaxSection,
} from '../../../core/tax/tax-sections';

/** What the panel shows for the selection. */
type GuidanceView =
  | { readonly kind: 'pick' }
  | { readonly kind: 'section'; readonly section: TaxSection; readonly inherited: boolean }
  | { readonly kind: 'excluded'; readonly inherited: boolean }
  | { readonly kind: 'untagged'; readonly name: string };

interface GuidanceEntry {
  readonly termKey: TranslationKey;
  readonly textKey: TranslationKey;
}

const PARTS: readonly { readonly part: TaxGuidancePart; readonly termKey: TranslationKey }[] = [
  { part: 'belongs', termKey: 'tax.guidance.belongs' },
  { part: 'excludes', termKey: 'tax.guidance.excludes' },
  { part: 'receipts', termKey: 'tax.guidance.receipts' },
];

/**
 * What belongs into the selected category's tax section, what does not, which receipts to keep,
 * and the form it goes to. Qualitative only: never amounts, limits or form line numbers.
 */
@Component({
  selector: 'app-tax-guidance',
  templateUrl: './tax-guidance.component.html',
  styleUrls: ['../tax-ui.scss', './tax-guidance.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TaxCodeComponent],
})
export class TaxGuidanceComponent {
  protected readonly i18n = inject(TranslationService);
  protected readonly excludedCode: string = TAX_EXCLUDED_CODE;

  /** The selected category's name, or `null` while none is selected. */
  readonly categoryName = input.required<string | null>();
  readonly effective = input.required<EffectiveTaxSection | null>();

  protected readonly view: Signal<GuidanceView> = computed((): GuidanceView => {
    const name: string | null = this.categoryName();
    const effective: EffectiveTaxSection | null = this.effective();
    if (name === null || effective === null) return { kind: 'pick' };
    if (effective.section !== null) {
      return { kind: 'section', section: effective.section, inherited: effective.inherited };
    }
    if (effective.sourceCategoryId !== null) {
      return { kind: 'excluded', inherited: effective.inherited };
    }
    return { kind: 'untagged', name };
  });

  protected readonly entries: Signal<readonly GuidanceEntry[]> = computed(
    (): readonly GuidanceEntry[] => {
      const section: TaxSection | null = this.effective()?.section ?? null;
      if (section === null) return [];
      return PARTS.map(({ part, termKey }): GuidanceEntry => ({
        termKey,
        textKey: guidanceKey(section, part),
      }));
    },
  );

  protected nameKey(key: string): TranslationKey {
    return taxKey(key);
  }

  protected noteKey(section: TaxSection): TranslationKey {
    return guidanceKey(section, 'note');
  }
}
