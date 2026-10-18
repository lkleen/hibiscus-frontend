import { Injectable, Signal, WritableSignal, computed, signal } from '@angular/core';
import { RibbonBand } from './ribbon.model';

/**
 * Collects the bands of one page's ribbon. Provide it on the page component (not in root): the
 * `appRibbonBand` directive in the page and in child route components registers against it, and
 * `<app-ribbon>` renders the result.
 */
@Injectable()
export class RibbonHost {
  private readonly registered: WritableSignal<readonly RibbonBand[]> = signal<
    readonly RibbonBand[]
  >([]);

  /** Shown bands only, sorted by `order` (stable: ties keep registration order). */
  readonly bands: Signal<readonly RibbonBand[]> = computed((): readonly RibbonBand[] =>
    this.registered()
      .filter((band: RibbonBand): boolean => band.shown())
      .sort((a: RibbonBand, b: RibbonBand): number => a.order() - b.order()),
  );

  /** Returns the unregister function. */
  register(band: RibbonBand): () => void {
    if (this.registered().some((other: RibbonBand): boolean => other.id === band.id)) {
      throw new Error(`Ribbon band "${band.id}" is already registered`);
    }
    this.registered.update((bands: readonly RibbonBand[]): readonly RibbonBand[] => [
      ...bands,
      band,
    ]);
    return (): void =>
      this.registered.update((bands: readonly RibbonBand[]): readonly RibbonBand[] =>
        bands.filter((other: RibbonBand): boolean => other !== band),
      );
  }
}
