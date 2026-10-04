import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  Signal,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import type { DatePreset, DatePresetUnit } from '@hibiscus-frontend/shared/contracts/user-settings';
import { map, startWith } from 'rxjs';
import { TranslationKey } from '../../../../core/models/translation.model';
import { DatePresetService } from '../../../../core/services/date-preset.service';
import { TranslationService } from '../../../../core/services/translation.service';
import {
  DATE_PRESET_UNITS,
  formatRange,
  resolvePreset,
  toIsoDate,
} from '../../../../core/utils/date-range';
import { DATE_PRESET_LIMITS } from '../date-preset-limits';

const MIN_AGO = 0;

type PresetKind = DatePreset['kind'];
type EditorError = 'nameLength' | 'count' | 'ago' | 'from' | 'to' | 'order';

interface EditorValue {
  name: string;
  kind: PresetKind;
  unit: DatePresetUnit;
  count: number | null;
  ago: number | null;
  from: string;
  to: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isWholeNumberIn(value: number | null, min: number, max: number): value is number {
  return value !== null && Number.isInteger(value) && value >= min && value <= max;
}

/** Everything but the name; these errors decide whether a definition exists at all. */
function definitionErrors(value: EditorValue): EditorError[] {
  const errors: EditorError[] = [];
  if (value.kind === 'relative') {
    if (!isWholeNumberIn(value.count, DATE_PRESET_LIMITS.minCount, DATE_PRESET_LIMITS.maxCount)) {
      errors.push('count');
    }
    if (!isWholeNumberIn(value.ago, MIN_AGO, DATE_PRESET_LIMITS.maxAgo)) errors.push('ago');
    return errors;
  }
  if (!ISO_DATE.test(value.from)) errors.push('from');
  if (!ISO_DATE.test(value.to)) errors.push('to');
  if (errors.length === 0 && value.from > value.to) errors.push('order');
  return errors;
}

/** The preset without its name; `null` while the definition is invalid. */
function buildDefinition(value: EditorValue, id: string): DatePreset | null {
  if (definitionErrors(value).length > 0) return null;
  if (value.kind === 'fixed') {
    return { id, name: null, kind: 'fixed', from: value.from, to: value.to };
  }
  if (value.count === null || value.ago === null) throw new Error('Validated value lost a field');
  return {
    id,
    name: null,
    kind: 'relative',
    unit: value.unit,
    count: value.count,
    offset: 0 - value.ago,
  };
}

/** The inline form for one date preset; the parent owns the list and the actual saving. */
@Component({
  selector: 'app-preset-editor',
  templateUrl: './preset-editor.component.html',
  styleUrl: './preset-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule],
})
export class PresetEditorComponent implements OnInit {
  protected readonly i18n = inject(TranslationService);
  private readonly service = inject(DatePresetService);

  /** The draft being edited; read once when the editor opens, later changes are ignored. */
  readonly preset = input.required<DatePreset>();
  /** The parent is saving; nothing can be submitted or cancelled meanwhile. */
  readonly disabled = input<boolean>(false);
  /** The validated preset, with its name. */
  readonly saved = output<DatePreset>();
  readonly cancelled = output<void>();

  protected readonly countRange: { min: number; max: number } = {
    min: DATE_PRESET_LIMITS.minCount,
    max: DATE_PRESET_LIMITS.maxCount,
  };
  protected readonly agoRange: { min: number; max: number } = {
    min: MIN_AGO,
    max: DATE_PRESET_LIMITS.maxAgo,
  };
  protected readonly units: readonly DatePresetUnit[] = DATE_PRESET_UNITS;

  private readonly today: Date = new Date();

  protected readonly form = new FormGroup({
    name: new FormControl<string>('', { nonNullable: true }),
    kind: new FormControl<PresetKind>('relative', { nonNullable: true }),
    unit: new FormControl<DatePresetUnit>('month', { nonNullable: true }),
    count: new FormControl<number | null>(1),
    ago: new FormControl<number | null>(0),
    from: new FormControl<string>('', { nonNullable: true }),
    to: new FormControl<string>('', { nonNullable: true }),
  });

  private readonly value: Signal<EditorValue> = toSignal(
    this.form.valueChanges.pipe(
      startWith(null),
      map((): EditorValue => this.form.getRawValue()),
    ),
    { requireSync: true },
  );

  protected readonly errors: Signal<EditorError[]> = computed((): EditorError[] => {
    const errors: EditorError[] = definitionErrors(this.value());
    if (this.value().name.trim().length > DATE_PRESET_LIMITS.maxNameLength) {
      errors.unshift('nameLength');
    }
    return errors;
  });

  private readonly definition: Signal<DatePreset | null> = computed((): DatePreset | null =>
    buildDefinition(this.value(), this.preset().id),
  );

  /** The valid draft, with its name; `null` while anything is invalid. */
  private readonly draft: Signal<DatePreset | null> = computed((): DatePreset | null => {
    const definition: DatePreset | null = this.definition();
    if (definition === null || this.errors().includes('nameLength')) return null;
    const name: string = this.value().name.trim();
    return { ...definition, name: name === '' ? null : name };
  });

  protected readonly canSave: Signal<boolean> = computed(
    (): boolean => this.draft() !== null && !this.disabled(),
  );

  protected readonly autoName: Signal<string> = computed((): string => {
    const definition: DatePreset | null = this.definition();
    return definition === null
      ? this.i18n.t('settings.presets.editor.namePlaceholder')
      : this.service.label(definition);
  });

  protected readonly preview: Signal<string | null> = computed((): string | null => {
    const definition: DatePreset | null = this.definition();
    return definition === null ? null : formatRange(resolvePreset(definition, this.today));
  });

  ngOnInit(): void {
    const preset: DatePreset = this.preset();
    const today: string = toIsoDate(this.today);
    this.form.setValue({
      name: preset.name ?? '',
      kind: preset.kind,
      unit: preset.kind === 'relative' ? preset.unit : 'month',
      count: preset.kind === 'relative' ? preset.count : 1,
      ago: preset.kind === 'relative' ? 0 - preset.offset : 0,
      from: preset.kind === 'fixed' ? preset.from : today,
      to: preset.kind === 'fixed' ? preset.to : today,
    });
  }

  protected errorText(error: EditorError): string {
    switch (error) {
      case 'nameLength':
        return this.i18n.t('settings.presets.error.nameLength', {
          max: DATE_PRESET_LIMITS.maxNameLength,
        });
      case 'count':
        return this.i18n.t('settings.presets.error.count', this.countRange);
      case 'ago':
        return this.i18n.t('settings.presets.error.ago', this.agoRange);
      case 'from':
        return this.i18n.t('settings.presets.error.from');
      case 'to':
        return this.i18n.t('settings.presets.error.to');
      case 'order':
        return this.i18n.t('settings.presets.error.order');
    }
  }

  protected unitLabel(unit: DatePresetUnit): string {
    const key: TranslationKey = `settings.unit.${unit}`;
    return this.i18n.t(key);
  }

  protected submit(): void {
    const draft: DatePreset | null = this.draft();
    if (draft === null) throw new Error('Cannot save an invalid date preset');
    if (this.disabled()) return;
    this.saved.emit(draft);
  }
}
