import { CdkMenu, CdkMenuItemRadio, CdkMenuTrigger } from '@angular/cdk/menu';
import { ConnectedPosition } from '@angular/cdk/overlay';
import {
  ChangeDetectionStrategy,
  Component,
  Signal,
  computed,
  effect,
  inject,
  model,
  signal,
  untracked,
} from '@angular/core';
import type { DatePreset } from '@hibiscus-frontend/shared/contracts/user-settings';
import { DatePresetService } from '../../../core/services/date-preset.service';
import { TranslationService } from '../../../core/services/translation.service';
import { DateRange, formatRange, resolvePreset } from '../../../core/utils/date-range';

/** A menu row: the preset and the dates it resolves to on the day the menu was opened. */
export interface DateRangePresetItem {
  readonly preset: DatePreset;
  readonly label: string;
  readonly dates: string;
}

let nextId = 0;

/**
 * Period picker: a preset dropdown (CDK menu, same vocabulary as the user menu) plus From/To date
 * inputs. Every preset row shows the dates it resolves to today, so a relative preset is never a
 * guess. Selection is session-only state of the parent via `range`; the presets themselves are the
 * user's, from `DatePresetService`.
 *
 * Until the user touches the picker, it follows the first preset: once the presets have loaded it
 * adopts that preset's range — unless the parent already provided one.
 */
@Component({
  selector: 'app-date-range-filter',
  templateUrl: './date-range-filter.component.html',
  styleUrl: './date-range-filter.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CdkMenu, CdkMenuItemRadio, CdkMenuTrigger],
})
export class DateRangeFilterComponent {
  private readonly presetService = inject(DatePresetService);
  protected readonly i18n = inject(TranslationService);

  readonly range = model<DateRange | null>(null);

  protected readonly id: string = `date-range-filter-${nextId++}`;
  protected readonly loadError: Signal<boolean> = this.presetService.loadError;

  protected readonly selectedPresetId = signal<string | null>(null);
  private readonly touched = signal<boolean>(false);
  private readonly initialised = signal<boolean>(false);

  /** Captured when the menu opens, so the previews can't go stale across midnight. */
  private readonly today = signal<Date>(new Date());

  protected readonly items: Signal<readonly DateRangePresetItem[]> = computed(
    (): readonly DateRangePresetItem[] => {
      const today: Date = this.today();
      return this.presetService.presets().map((preset: DatePreset): DateRangePresetItem => ({
        preset,
        label: this.presetService.label(preset),
        dates: formatRange(resolvePreset(preset, today)),
      }));
    },
  );

  protected readonly selectedPreset: Signal<DatePreset | null> = computed(
    (): DatePreset | null =>
      this.presetService.presets().find((p: DatePreset) => p.id === this.selectedPresetId()) ??
      null,
  );

  protected readonly allDatesSelected: Signal<boolean> = computed(
    (): boolean => this.range() === null && this.selectedPreset() === null,
  );

  protected readonly triggerLabel: Signal<string> = computed((): string => {
    const selected: DatePreset | null = this.selectedPreset();
    if (selected) return this.presetService.label(selected);
    return this.i18n.t(
      this.range() === null ? 'dateRangeFilter.allDates' : 'dateRangeFilter.custom',
    );
  });

  protected readonly panelPositions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
  ];

  constructor() {
    // The initial preset is decided exactly once, when the presets arrive. After that — or once
    // the user touched the picker, or the parent set a range — nothing here may overwrite it.
    effect((): void => {
      if (!this.presetService.loaded() || this.initialised()) return;
      untracked((): void => {
        this.initialised.set(true);
        const first: DatePreset | undefined = this.presetService.presets()[0];
        if (this.touched() || this.range() !== null || !first) return;
        this.selectedPresetId.set(first.id);
        this.range.set(resolvePreset(first, new Date()));
      });
    });
  }

  protected onMenuOpened(): void {
    this.today.set(new Date());
  }

  protected selectPreset(preset: DatePreset): void {
    this.touched.set(true);
    this.selectedPresetId.set(preset.id);
    this.range.set(resolvePreset(preset, new Date()));
  }

  protected selectAllDates(): void {
    this.touched.set(true);
    this.selectedPresetId.set(null);
    this.range.set(null);
  }

  protected onFromInput(event: Event): void {
    this.editRange({ from: this.valueOf(event), to: this.range()?.to ?? null });
  }

  protected onToInput(event: Event): void {
    this.editRange({ from: this.range()?.from ?? null, to: this.valueOf(event) });
  }

  /** A hand-edited range belongs to no preset; clearing both ends is the same as no range. */
  private editRange(range: DateRange): void {
    this.touched.set(true);
    this.selectedPresetId.set(null);
    this.range.set(range.from === null && range.to === null ? null : range);
  }

  /** An empty `<input type="date">` is an open end. */
  private valueOf(event: Event): string | null {
    const target: EventTarget | null = event.target;
    if (!(target instanceof HTMLInputElement)) throw new Error('expected a date input event');
    return target.value === '' ? null : target.value;
  }
}
