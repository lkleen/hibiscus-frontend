import { DestroyRef, Injectable, Signal, inject } from '@angular/core';
import type {
  DatePreset,
  DatePresetList,
  DatePresetUnit,
} from '@hibiscus-frontend/shared/contracts/user-settings';
import { of, switchMap } from 'rxjs';
import { TranslationKey } from '../models/translation.model';
import { ApiService } from './api.service';
import { TranslationService } from './translation.service';
import { UserSettingChannel } from './user-setting-channel';

/**
 * The user's date range presets, shared app-wide and loaded once on construction.
 *
 * Every write (save, restore defaults) goes through a single queue, so the server receives them in
 * call order. `presets` only changes after the server confirmed a write — the UI never shows an
 * unsaved list. A failed write sets `saveError` and the queue keeps running.
 */
@Injectable({ providedIn: 'root' })
export class DatePresetService {
  private readonly api = inject(ApiService);
  private readonly translation = inject(TranslationService);

  private readonly channel = new UserSettingChannel<DatePresetList>({
    load: () => this.api.getDatePresets(),
    initial: [],
    label: 'date presets',
    destroyRef: inject(DestroyRef),
  });

  readonly presets: Signal<DatePresetList> = this.channel.value;
  readonly loaded: Signal<boolean> = this.channel.loaded;
  readonly loadError: Signal<boolean> = this.channel.loadError;
  readonly saving: Signal<boolean> = this.channel.saving;
  readonly saveError: Signal<boolean> = this.channel.saveError;

  /** Replaces the whole list. `presets` shows it once the server has confirmed. */
  save(presets: DatePresetList): void {
    this.channel.enqueue(this.api.saveDatePresets(presets).pipe(switchMap(() => of(presets))));
  }

  /** Deletes the stored list, then adopts the defaults the server answers with. */
  restoreDefaults(): void {
    this.channel.enqueue(
      this.api.resetDatePresets().pipe(switchMap(() => this.api.getDatePresets())),
    );
  }

  /** The user-given name, or one generated from the definition in the active locale. */
  label(preset: DatePreset): string {
    if (preset.name !== null) return preset.name;
    if (preset.kind === 'fixed') {
      return this.translation.t('datePreset.name.fixed', { from: preset.from, to: preset.to });
    }
    const unit: DatePresetUnit = preset.unit;
    if (preset.count === 1 && preset.offset === 0) {
      return this.translation.t(this.key('current', unit));
    }
    if (preset.count === 1 && preset.offset === -1) {
      return this.translation.t(this.key('last', unit));
    }
    if (preset.offset === 0) {
      return this.translation.t(this.key('lastN', unit), { count: preset.count });
    }
    return this.translation.t(this.key('generic', unit), {
      count: preset.count,
      ago: -preset.offset,
    });
  }

  private key(
    variant: 'current' | 'last' | 'lastN' | 'generic',
    unit: DatePresetUnit,
  ): TranslationKey {
    return `datePreset.name.${variant}.${unit}`;
  }
}
