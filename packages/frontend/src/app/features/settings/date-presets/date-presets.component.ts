import {
  ChangeDetectionStrategy,
  Component,
  Signal,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import type { DatePreset, DatePresetList } from '@hibiscus-frontend/shared/contracts/user-settings';
import { DatePresetService } from '../../../core/services/date-preset.service';
import { TranslationService } from '../../../core/services/translation.service';
import { formatRange, resolvePreset } from '../../../core/utils/date-range';
import { DATE_PRESET_LIMITS } from './date-preset-limits';
import { PresetEditorComponent } from './preset-editor/preset-editor.component';

interface PresetRow {
  preset: DatePreset;
  label: string;
  dates: string;
}

@Component({
  selector: 'app-date-presets',
  templateUrl: './date-presets.component.html',
  styleUrl: './date-presets.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PresetEditorComponent],
})
export class DatePresetsComponent {
  protected readonly i18n = inject(TranslationService);
  protected readonly service = inject(DatePresetService);

  protected readonly maxPresets: number = DATE_PRESET_LIMITS.maxPresets;

  private readonly today: Date = new Date();

  /** Id of the preset in the editor; `null` = editor closed. */
  protected readonly editingId = signal<string | null>(null);
  /** The not yet saved preset in the editor; `null` unless the editor is adding. */
  protected readonly newPreset = signal<DatePreset | null>(null);
  protected readonly isNew: Signal<boolean> = computed((): boolean => this.newPreset() !== null);
  /** A save from the editor is in flight; the editor closes once it succeeded. */
  private readonly submitted = signal<boolean>(false);

  protected readonly rows: Signal<PresetRow[]> = computed((): PresetRow[] =>
    this.service.presets().map((preset: DatePreset) => ({
      preset,
      label: this.service.label(preset),
      dates: formatRange(resolvePreset(preset, this.today)),
    })),
  );

  protected readonly atLimit: Signal<boolean> = computed(
    (): boolean => this.service.presets().length >= DATE_PRESET_LIMITS.maxPresets,
  );

  constructor() {
    // Keep the editor (and the user's input) open until the server confirmed the save; a failed
    // save leaves it open next to the error message.
    effect(() => {
      const saving: boolean = this.service.saving();
      const failed: boolean = this.service.saveError();
      untracked(() => {
        if (saving || !this.submitted()) return;
        this.submitted.set(false);
        if (!failed) this.closeEditor();
      });
    });
  }

  protected startAdd(): void {
    const draft: DatePreset = {
      id: crypto.randomUUID(),
      name: null,
      kind: 'relative',
      unit: 'month',
      count: 1,
      offset: 0,
    };
    this.newPreset.set(draft);
    this.editingId.set(draft.id);
  }

  protected startEdit(preset: DatePreset): void {
    this.newPreset.set(null);
    this.editingId.set(preset.id);
  }

  protected save(draft: DatePreset): void {
    if (this.service.saving()) return;
    // Always built on the latest confirmed list, never on a copy taken when the editor opened.
    const current: DatePresetList = this.service.presets();
    let next: DatePresetList;
    if (this.isNew()) {
      if (current.length >= DATE_PRESET_LIMITS.maxPresets) {
        throw new Error('Date preset limit reached');
      }
      next = [...current, draft];
    } else {
      if (!current.some((preset: DatePreset) => preset.id === draft.id)) {
        throw new Error(`Date preset ${draft.id} no longer exists`);
      }
      next = current.map((preset: DatePreset) => (preset.id === draft.id ? draft : preset));
    }
    this.submitted.set(true);
    this.service.save(next);
  }

  protected move(preset: DatePreset, delta: -1 | 1): void {
    const next: DatePresetList = [...this.service.presets()];
    const index: number = next.findIndex((candidate: DatePreset) => candidate.id === preset.id);
    if (index === -1) throw new Error(`Date preset ${preset.id} no longer exists`);
    const target: number = index + delta;
    if (target < 0 || target >= next.length) throw new Error('Cannot move past the list ends');
    [next[index], next[target]] = [next[target] as DatePreset, next[index] as DatePreset];
    this.service.save(next);
  }

  protected remove(preset: DatePreset): void {
    if (this.editingId() === preset.id) this.closeEditor();
    this.service.save(this.service.presets().filter((p: DatePreset) => p.id !== preset.id));
  }

  protected restoreDefaults(): void {
    this.closeEditor();
    this.service.restoreDefaults();
  }

  protected closeEditor(): void {
    this.editingId.set(null);
    this.newPreset.set(null);
  }
}
