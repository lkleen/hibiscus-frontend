import { ChangeDetectionStrategy, Component, inject, input, model } from '@angular/core';
import type { KeyMode } from '@hibiscus-frontend/shared/contracts/user';
import type { TranslationKey } from '../../../core/models/translation.model';
import { TranslationService } from '../../../core/services/translation.service';

/** The key modes in the order shown (safest first) with their texts. */
export interface KeyModeOption {
  readonly mode: KeyMode;
  readonly title: TranslationKey;
  readonly summary: TranslationKey;
  readonly risk: TranslationKey;
}

export const KEY_MODE_OPTIONS: readonly KeyModeOption[] = [
  {
    mode: 'manual',
    title: 'keyMode.manual.title',
    summary: 'keyMode.manual.summary',
    risk: 'keyMode.manual.risk',
  },
  {
    mode: 'memory',
    title: 'keyMode.memory.title',
    summary: 'keyMode.memory.summary',
    risk: 'keyMode.memory.risk',
  },
  {
    mode: 'stored',
    title: 'keyMode.stored.title',
    summary: 'keyMode.stored.summary',
    risk: 'keyMode.stored.risk',
  },
];

/** The title of a mode, for status lines. */
export function keyModeTitle(mode: KeyMode): TranslationKey {
  const option: KeyModeOption | undefined = KEY_MODE_OPTIONS.find(
    (entry: KeyModeOption) => entry.mode === mode,
  );
  if (!option) throw new Error(`Unknown key mode ${mode}`);
  return option.title;
}

/**
 * The three ways the server may handle the user's key, each with what it costs in safety and what
 * it gives in convenience. Two-way bound through `mode`.
 */
@Component({
  selector: 'app-key-mode-picker',
  templateUrl: './key-mode-picker.component.html',
  styleUrl: './key-mode-picker.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KeyModePickerComponent {
  protected readonly i18n = inject(TranslationService);

  readonly mode = model.required<KeyMode>();
  readonly disabled = input(false);
  protected readonly options: readonly KeyModeOption[] = KEY_MODE_OPTIONS;

  protected onPick(mode: KeyMode): void {
    this.mode.set(mode);
  }
}
