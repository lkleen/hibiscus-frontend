import { Injectable, Signal, WritableSignal, computed, signal } from '@angular/core';
import { RibbonMode } from './ribbon.model';

export interface RibbonViewState {
  readonly activeId: string | null;
  readonly mode: RibbonMode;
}

const INITIAL_STATE: RibbonViewState = { activeId: null, mode: 'full' };

/** Selected band and mode per ribbon id; in memory, so it lasts for the session only. */
@Injectable({ providedIn: 'root' })
export class RibbonStateStore {
  private readonly states: WritableSignal<Readonly<Record<string, RibbonViewState>>> = signal<
    Readonly<Record<string, RibbonViewState>>
  >({});

  state(ribbonId: string): Signal<RibbonViewState> {
    return computed((): RibbonViewState => this.states()[ribbonId] ?? INITIAL_STATE);
  }

  setActive(ribbonId: string, activeId: string): void {
    this.patch(ribbonId, { activeId });
  }

  setMode(ribbonId: string, mode: RibbonMode): void {
    this.patch(ribbonId, { mode });
  }

  private patch(ribbonId: string, change: Partial<RibbonViewState>): void {
    this.states.update(
      (
        all: Readonly<Record<string, RibbonViewState>>,
      ): Readonly<Record<string, RibbonViewState>> => ({
        ...all,
        [ribbonId]: { ...(all[ribbonId] ?? INITIAL_STATE), ...change },
      }),
    );
  }
}
