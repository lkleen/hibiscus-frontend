import { Injectable, Signal, inject, signal, type WritableSignal } from '@angular/core';
import type { TaxTag, TaxTagCode } from '@hibiscus-frontend/shared/contracts/tax-tags';
import { Observable, map, tap } from 'rxjs';
import { ApiService } from './api.service';

/**
 * The tax-return tags of the categories (category id → tag), shared app-wide. Only the server's
 * answers change `tags`.
 */
@Injectable({ providedIn: 'root' })
export class TaxTagsService {
  private readonly api = inject(ApiService);
  private readonly state: WritableSignal<ReadonlyMap<number, TaxTagCode> | null> =
    signal<ReadonlyMap<number, TaxTagCode> | null>(null);

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
   * Records a category's tag after the server saved it (with the category); `null` removes it.
   * Throws when the tags are not loaded.
   */
  applySaved(categoryId: number, code: TaxTagCode | null): void {
    const current: ReadonlyMap<number, TaxTagCode> | null = this.state();
    if (current === null) throw new Error('tax tags are not loaded');
    const next: Map<number, TaxTagCode> = new Map<number, TaxTagCode>(current);
    if (code === null) next.delete(categoryId);
    else next.set(categoryId, code);
    this.state.set(next);
  }

  /**
   * Follows a renamed section: every tag with code `from` gets code `to`. Before the tags are
   * loaded there is nothing to follow; the first load already carries the new code.
   */
  renameCode(from: TaxTagCode, to: TaxTagCode): void {
    const current: ReadonlyMap<number, TaxTagCode> | null = this.state();
    if (current === null) return;
    this.state.set(
      new Map<number, TaxTagCode>(
        [...current].map(([id, code]: [number, TaxTagCode]): [number, TaxTagCode] => [
          id,
          code === from ? to : code,
        ]),
      ),
    );
  }
}
