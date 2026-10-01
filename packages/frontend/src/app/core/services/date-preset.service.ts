import { DestroyRef, Injectable, Signal, computed, inject, signal } from '@angular/core';
import type {
  DatePreset,
  DatePresetList,
  DatePresetUnit,
} from '@hibiscus-frontend/shared/contracts/user-settings';
import { Observable, Subject, Subscription, catchError, concatMap, of, switchMap, tap } from 'rxjs';
import { TranslationKey } from '../models/translation.model';
import { ApiService } from './api.service';
import { TranslationService } from './translation.service';

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

  private readonly presetsState = signal<DatePresetList>([]);
  private readonly loadedState = signal<boolean>(false);
  private readonly loadErrorState = signal<boolean>(false);
  private readonly pending = signal<number>(0);
  private readonly saveErrorState = signal<boolean>(false);
  private readonly writes = new Subject<Observable<DatePresetList>>();

  readonly presets: Signal<DatePresetList> = this.presetsState.asReadonly();
  readonly loaded: Signal<boolean> = this.loadedState.asReadonly();
  readonly loadError: Signal<boolean> = this.loadErrorState.asReadonly();
  readonly saving: Signal<boolean> = computed((): boolean => this.pending() > 0);
  readonly saveError: Signal<boolean> = this.saveErrorState.asReadonly();

  constructor() {
    const destroyRef: DestroyRef = inject(DestroyRef);

    const load: Subscription = this.api.getDatePresets().subscribe({
      next: (presets: DatePresetList) => {
        // A write that finished before the initial load did is newer than the load result.
        if (!this.loadedState()) this.presetsState.set(presets);
        this.loadedState.set(true);
      },
      error: (error: unknown) => {
        console.error('Could not load date presets', error);
        this.loadErrorState.set(true);
      },
    });

    const queue: Subscription = this.writes
      .pipe(
        concatMap((write: Observable<DatePresetList>) =>
          write.pipe(
            tap((presets: DatePresetList) => {
              this.presetsState.set(presets);
              this.loadedState.set(true);
              this.saveErrorState.set(false);
            }),
            catchError((error: unknown) => {
              console.error('Could not save date presets', error);
              this.saveErrorState.set(true);
              return of(null);
            }),
            tap(() => this.pending.update((count: number) => count - 1)),
          ),
        ),
      )
      .subscribe();

    destroyRef.onDestroy(() => {
      load.unsubscribe();
      queue.unsubscribe();
    });
  }

  /** Replaces the whole list. `presets` shows it once the server has confirmed. */
  save(presets: DatePresetList): void {
    this.enqueue(this.api.saveDatePresets(presets).pipe(switchMap(() => of(presets))));
  }

  /** Deletes the stored list, then adopts the defaults the server answers with. */
  restoreDefaults(): void {
    this.enqueue(this.api.resetDatePresets().pipe(switchMap(() => this.api.getDatePresets())));
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

  private enqueue(write: Observable<DatePresetList>): void {
    this.pending.update((count: number) => count + 1);
    this.writes.next(write);
  }
}
