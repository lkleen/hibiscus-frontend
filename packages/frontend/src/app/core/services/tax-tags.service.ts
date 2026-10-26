import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, Signal, inject, signal, type WritableSignal } from '@angular/core';
import type {
  TaxTag,
  TaxTagChange,
  TaxTagCode,
  TaxTagsConflict,
} from '@hibiscus-frontend/shared/contracts/tax-tags';
import { Observable, catchError, defer, finalize, map, switchMap, tap, throwError } from 'rxjs';
import { ApiService } from './api.service';

/** The server rejected a save: the tags of `conflictIds` changed meanwhile (or are gone). */
export class TaxTagConflictError extends Error {
  constructor(readonly conflictIds: readonly number[]) {
    super(`tax tags of categories ${conflictIds.join(', ')} changed elsewhere`);
    this.name = 'TaxTagConflictError';
  }
}

function isConflict(body: unknown): body is TaxTagsConflict {
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as { error?: unknown }).error === 'conflict' &&
    Array.isArray((body as { conflictIds?: unknown }).conflictIds)
  );
}

/**
 * The tax-return tags of the categories (category id → tag), shared app-wide. Only the server's
 * answers change `tags`; at most one save runs at a time.
 */
@Injectable({ providedIn: 'root' })
export class TaxTagsService {
  private readonly api = inject(ApiService);
  private readonly state: WritableSignal<ReadonlyMap<number, TaxTagCode> | null> =
    signal<ReadonlyMap<number, TaxTagCode> | null>(null);
  private saveInFlight = false;

  /** `null` until loaded. */
  readonly tags: Signal<ReadonlyMap<number, TaxTagCode> | null> = this.state.asReadonly();

  /** Fetches the tags and replaces the map. */
  load(): Observable<void> {
    return this.api.getTaxTags().pipe(
      tap((rows: TaxTag[]): void => {
        this.state.set(
          new Map<number, TaxTagCode>(
            rows.map((r: TaxTag): [number, TaxTagCode] => [r.category_id, r.code]),
          ),
        );
      }),
      map((): void => undefined),
    );
  }

  /**
   * Saves `changes` all or nothing; on success they are applied to `tags`. A 409 reloads the tags
   * and errors with {@link TaxTagConflictError}. Throws when `changes` is empty or another save is
   * running; the save slot is held from subscription until the result finishes.
   */
  save(changes: readonly TaxTagChange[]): Observable<void> {
    if (changes.length === 0) throw new Error('save needs at least one change');
    if (this.saveInFlight) throw new Error('another tax tag save is in flight');
    return defer((): Observable<void> => {
      // Checked again on subscribe: two saves created back to back must not both run.
      if (this.saveInFlight) throw new Error('another tax tag save is in flight');
      this.saveInFlight = true;
      return this.api.saveTaxTags({ changes }).pipe(
        tap((): void => this.apply(changes)),
        catchError((cause: unknown): Observable<void> => {
          if (cause instanceof HttpErrorResponse && cause.status === 409) {
            const body: unknown = cause.error;
            if (!isConflict(body)) throw new Error('409 without a TaxTagsConflict body');
            return this.load().pipe(
              switchMap((): Observable<void> =>
                throwError(() => new TaxTagConflictError(body.conflictIds)),
              ),
            );
          }
          return throwError(() => cause);
        }),
        finalize((): void => {
          this.saveInFlight = false;
        }),
      );
    });
  }

  private apply(changes: readonly TaxTagChange[]): void {
    const current: ReadonlyMap<number, TaxTagCode> | null = this.state();
    if (current === null) throw new Error('tax tags are not loaded');
    const next: Map<number, TaxTagCode> = new Map<number, TaxTagCode>(current);
    for (const change of changes) {
      if (change.next === null) next.delete(change.category_id);
      else next.set(change.category_id, change.next);
    }
    this.state.set(next);
  }
}
