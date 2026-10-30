import { Injectable, computed, inject, signal, type Signal } from '@angular/core';
import type { Me } from '@hibiscus-frontend/shared/contracts/user';
import { Observable, finalize, of, shareReplay, tap } from 'rxjs';
import { ApiService } from './api.service';

/**
 * The signed-in user (`GET /api/me`), loaded once and shared app-wide: the route guards, the user
 * menu and the setup flow all read it. `database` and `key` flip to `configured` through `refresh()`
 * after the setup, and to `unconfigured` through `markUnconfigured()` when the backend answers `409`
 * `database-not-configured`.
 */
@Injectable({ providedIn: 'root' })
export class MeService {
  private readonly api = inject(ApiService);
  private readonly state = signal<Me | null>(null);
  private loading: Observable<Me> | null = null;

  /** `null` until the first answer. */
  readonly me: Signal<Me | null> = this.state.asReadonly();
  readonly user: Signal<string | null> = computed(() => this.state()?.user ?? null);
  /** The step the setup opens at: the database first, then the key (mode and key). */
  readonly firstOpenStep: Signal<'database' | 'mode'> = computed(() =>
    this.state()?.database === 'configured' ? 'mode' : 'database',
  );
  /** The last load failed; `user` stays `null`. */
  readonly error = signal(false);

  /** Emits the cached user, or loads it; concurrent callers share one request. */
  load(): Observable<Me> {
    const cached: Me | null = this.state();
    if (cached !== null) return of(cached);
    this.loading ??= this.refresh().pipe(
      finalize((): void => {
        this.loading = null;
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return this.loading;
  }

  /** Always asks the backend. */
  refresh(): Observable<Me> {
    return this.api.getMe().pipe(
      tap({
        next: (me: Me): void => {
          this.state.set(me);
          this.error.set(false);
        },
        error: (): void => this.error.set(true),
      }),
    );
  }

  markUnconfigured(): void {
    const current: Me | null = this.state();
    if (current === null) throw new Error('markUnconfigured before the user was loaded');
    this.state.set({ ...current, database: 'unconfigured' });
  }
}
