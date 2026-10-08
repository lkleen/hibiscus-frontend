import { DestroyRef, Signal, computed, signal } from '@angular/core';
import { Observable, Subject, catchError, concatMap, of, tap } from 'rxjs';

export interface UserSettingChannelOptions<T> {
  /** Fetches the stored value; called once on construction. */
  readonly load: () => Observable<T>;
  /** Shown until the first load or write is confirmed. */
  readonly initial: T;
  /** Names the setting in console error messages, e.g. 'date presets'. */
  readonly label: string;
  readonly destroyRef: DestroyRef;
}

/**
 * Loads one per-user setting once and funnels every write through a single serial queue, so the
 * server receives them in call order. `value` only changes after the server confirmed a write or
 * the load answered — unsaved state is never exposed. A failed write sets `saveError` and the
 * queue keeps running. Not injectable: a service owns one instance, created in its constructor.
 */
export class UserSettingChannel<T> {
  private readonly valueState: ReturnType<typeof signal<T>>;
  private readonly loadedState = signal<boolean>(false);
  private readonly loadErrorState = signal<boolean>(false);
  private readonly pending = signal<number>(0);
  private readonly saveErrorState = signal<boolean>(false);
  private readonly writes = new Subject<Observable<T>>();

  readonly value: Signal<T>;
  readonly loaded: Signal<boolean> = this.loadedState.asReadonly();
  readonly loadError: Signal<boolean> = this.loadErrorState.asReadonly();
  readonly saving: Signal<boolean> = computed((): boolean => this.pending() > 0);
  readonly saveError: Signal<boolean> = this.saveErrorState.asReadonly();

  constructor(options: UserSettingChannelOptions<T>) {
    this.valueState = signal<T>(options.initial);
    this.value = this.valueState.asReadonly();

    const load = options.load().subscribe({
      next: (value: T) => {
        // A write that finished before the initial load did is newer than the load result.
        if (!this.loadedState()) this.valueState.set(value);
        this.loadedState.set(true);
      },
      error: (error: unknown) => {
        console.error(`Could not load ${options.label}`, error);
        this.loadErrorState.set(true);
      },
    });

    const queue = this.writes
      .pipe(
        concatMap((write: Observable<T>) =>
          write.pipe(
            tap((value: T) => {
              this.valueState.set(value);
              this.loadedState.set(true);
              this.saveErrorState.set(false);
            }),
            catchError((error: unknown) => {
              console.error(`Could not save ${options.label}`, error);
              this.saveErrorState.set(true);
              return of(null);
            }),
            tap(() => this.pending.update((count: number) => count - 1)),
          ),
        ),
      )
      .subscribe();

    options.destroyRef.onDestroy(() => {
      load.unsubscribe();
      queue.unsubscribe();
    });
  }

  /** Queues a write; `value` adopts what the observable emits once the server confirmed. */
  enqueue(write: Observable<T>): void {
    this.pending.update((count: number) => count + 1);
    this.writes.next(write);
  }
}
