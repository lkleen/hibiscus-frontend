import { CdkMenu, CdkMenuItemRadio, CdkMenuTrigger } from '@angular/cdk/menu';
import { ConnectedPosition } from '@angular/cdk/overlay';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Signal,
  WritableSignal,
  computed,
  effect,
  inject,
  linkedSignal,
  model,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { DatePreset, DatePresetUnit } from '@hibiscus-frontend/shared/contracts/user-settings';
import { DatePresetService } from '../../../core/services/date-preset.service';
import { TranslationKey } from '../../../core/models/translation.model';
import { TranslationService } from '../../../core/services/translation.service';
import {
  DATE_PRESET_UNITS,
  DateRange,
  adjacentPeriod,
  formatRange,
  resolvePreset,
} from '../../../core/utils/date-range';

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

  /** Unit of the previous/next buttons: follows a relative preset, otherwise keeps its last value. */
  protected readonly stepUnit: WritableSignal<DatePresetUnit> = linkedSignal<
    DatePreset | null,
    DatePresetUnit
  >({
    source: this.selectedPreset,
    computation: (preset: DatePreset | null, previous): DatePresetUnit =>
      preset?.kind === 'relative' ? preset.unit : (previous?.value ?? 'month'),
  });

  protected readonly units: readonly DatePresetUnit[] = DATE_PRESET_UNITS;

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

  private readonly fromInput = viewChild.required<ElementRef<HTMLInputElement>>('fromInput');
  private readonly toInput = viewChild.required<ElementRef<HTMLInputElement>>('toInput');

  /**
   * The range the user last produced by typing (`undefined` = none since the last preset/All
   * dates). The date inputs are deliberately *not* bound with `[value]`: writing `value` into a
   * native date field resets Chrome's segment typing, so typing a year digit by digit ("2", "20",
   * "202", "2025" — each a valid date to Chrome, years 0002…2025) would restart at every digit and
   * end on a wrong year. The fields are written only when the range comes from elsewhere.
   */
  private typedRange: DateRange | null | undefined = undefined;

  constructor() {
    // Mirrors every range that did not come from typing (preset, All dates, the parent) into the
    // fields, including their mutual `min`/`max`.
    effect((): void => {
      const range: DateRange | null = this.range();
      if (range === this.typedRange) return;
      this.writeField(this.fromInput().nativeElement, range?.from ?? null);
      this.writeField(this.toInput().nativeElement, range?.to ?? null);
      this.fromInput().nativeElement.max = range?.to ?? '';
      this.toInput().nativeElement.min = range?.from ?? '';
    });

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
    this.typedRange = undefined;
    this.range.set(resolvePreset(preset, new Date()));
  }

  protected selectAllDates(): void {
    this.touched.set(true);
    this.selectedPresetId.set(null);
    this.typedRange = undefined;
    this.range.set(null);
  }

  /** Moves the range to the whole period before/after the current one, in the chosen unit. */
  protected step(direction: -1 | 1): void {
    this.touched.set(true);
    this.selectedPresetId.set(null);
    this.typedRange = undefined;
    this.range.set(adjacentPeriod(this.range(), { unit: this.stepUnit(), direction }, new Date()));
  }

  protected onStepUnitChange(event: Event): void {
    const target: EventTarget | null = event.target;
    if (!(target instanceof HTMLSelectElement)) throw new Error('expected a select event');
    const unit: DatePresetUnit | undefined = DATE_PRESET_UNITS.find(
      (u: DatePresetUnit): boolean => u === target.value,
    );
    if (!unit) throw new Error(`unknown step unit: ${target.value}`);
    this.stepUnit.set(unit);
  }

  protected unitLabel(unit: DatePresetUnit): string {
    const key: TranslationKey = `settings.unit.${unit}`;
    return this.i18n.t(key);
  }

  protected onFromInput(event: Event): void {
    const from: string | null | undefined = this.valueOf(event);
    if (from === undefined) return;
    // Only the *other* field's limit is updated: touching the field being typed in would reset it.
    this.toInput().nativeElement.min = from ?? '';
    this.editRange({ from, to: this.range()?.to ?? null });
  }

  protected onToInput(event: Event): void {
    const to: string | null | undefined = this.valueOf(event);
    if (to === undefined) return;
    this.fromInput().nativeElement.max = to ?? '';
    this.editRange({ from: this.range()?.from ?? null, to });
  }

  /** A hand-edited range belongs to no preset; clearing both ends is the same as no range. */
  private editRange(range: DateRange): void {
    this.touched.set(true);
    this.selectedPresetId.set(null);
    const next: DateRange | null = range.from === null && range.to === null ? null : range;
    this.typedRange = next;
    this.range.set(next);
  }

  /**
   * An empty `<input type="date">` is an open end (`null`). `undefined` means the user is still
   * typing the year: Chrome reports each digit as a full date (0002, 0020, 0202), and filtering on
   * those would empty the table mid-typing, so a year below 1000 is not applied yet.
   */
  private valueOf(event: Event): string | null | undefined {
    const target: EventTarget | null = event.target;
    if (!(target instanceof HTMLInputElement)) throw new Error('expected a date input event');
    if (target.value === '') return null;
    return Number(target.value.slice(0, 4)) < 1000 ? undefined : target.value;
  }

  /** Writes only on an actual change, so an unchanged field keeps the user's caret/segment. */
  private writeField(input: HTMLInputElement, value: string | null): void {
    const next: string = value ?? '';
    if (input.value !== next) input.value = next;
  }
}
