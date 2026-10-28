import { Injectable, Signal, inject, signal, type WritableSignal } from '@angular/core';
import type {
  TaxSection,
  TaxSectionCode,
  TaxSectionUpdateRequest,
} from '@hibiscus-frontend/shared/contracts/tax-tags';
import { Observable, map, tap } from 'rxjs';
import { ApiService } from './api.service';
import { TaxTagsService } from './tax-tags.service';

function byCode(a: TaxSection, b: TaxSection): number {
  return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
}

/**
 * The user-maintained tax sections, ordered by code, shared app-wide. Only the server's answers
 * change `sections`; a renamed code is carried over to the tags.
 */
@Injectable({ providedIn: 'root' })
export class TaxSectionsService {
  private readonly api = inject(ApiService);
  private readonly taxTags = inject(TaxTagsService);
  private readonly state: WritableSignal<readonly TaxSection[] | null> = signal<
    readonly TaxSection[] | null
  >(null);

  /** `null` until loaded. */
  readonly sections: Signal<readonly TaxSection[] | null> = this.state.asReadonly();

  /** Fetches the sections and replaces the list. */
  load(): Observable<void> {
    return this.api.getTaxSections().pipe(
      tap((rows: TaxSection[]): void => this.state.set([...rows].sort(byCode))),
      map((): void => undefined),
    );
  }

  /** Creates `section`; the list gets the section as stored. */
  create(section: TaxSection): Observable<TaxSection> {
    return this.api.createTaxSection(section).pipe(
      tap((stored: TaxSection): void => {
        this.state.set([...this.loaded(), stored].sort(byCode));
      }),
    );
  }

  /** Saves `request.next` over `request.expected`; a changed code is carried over to the tags. */
  update(code: TaxSectionCode, request: TaxSectionUpdateRequest): Observable<void> {
    return this.api.updateTaxSection(code, request).pipe(
      tap((): void => {
        const current: readonly TaxSection[] = this.loaded();
        if (!current.some((s: TaxSection): boolean => s.code === code)) {
          throw new Error(`tax section "${code}" is not loaded`);
        }
        this.state.set(
          current
            .map((s: TaxSection): TaxSection => (s.code === code ? request.next : s))
            .sort(byCode),
        );
        if (request.next.code !== code) this.taxTags.renameCode(code, request.next.code);
      }),
    );
  }

  /** Deletes the section; `409` `{ error: 'in-use' }` while a category is tagged with it. */
  remove(code: TaxSectionCode): Observable<void> {
    return this.api.deleteTaxSection(code).pipe(
      tap((): void => {
        this.state.set(this.loaded().filter((s: TaxSection): boolean => s.code !== code));
      }),
    );
  }

  private loaded(): readonly TaxSection[] {
    const current: readonly TaxSection[] | null = this.state();
    if (current === null) throw new Error('tax sections are not loaded');
    return current;
  }
}
