import { DestroyRef, Injectable, Signal, computed, inject } from '@angular/core';
import type {
  TableDensities,
  TableDensity,
  TableViewId,
} from '@hibiscus-frontend/shared/contracts/user-settings';
import { defer, map } from 'rxjs';
import { ApiService } from './api.service';
import { UserSettingChannel } from './user-setting-channel';

/** Every density, least to most spacious. Typechecked against the shared union: none may be missing. */
export const TABLE_DENSITIES = [
  'extra-compact',
  'compact',
  'normal',
  'comfortable',
  'spacious',
] as const satisfies readonly TableDensity[];

type MissingDensity = Exclude<TableDensity, (typeof TABLE_DENSITIES)[number]>;
const ALL_DENSITIES_LISTED: [MissingDensity] extends [never] ? true : never = true;
void ALL_DENSITIES_LISTED;

/**
 * The user's table density per table view, shared app-wide and loaded once on construction.
 * Writes go through a serial queue and always PUT the whole map; each write merges into the map
 * as it stands when its turn comes, so consecutive writes never drop each other. `densityFor`
 * only changes once the server confirmed.
 */
@Injectable({ providedIn: 'root' })
export class TableDensityService {
  private readonly api = inject(ApiService);
  private readonly channel = new UserSettingChannel<TableDensities>({
    load: () => this.api.getTableDensities(),
    initial: {},
    label: 'table densities',
    destroyRef: inject(DestroyRef),
  });
  private readonly densityByView = new Map<TableViewId, Signal<TableDensity>>();

  readonly loaded: Signal<boolean> = this.channel.loaded;
  readonly loadError: Signal<boolean> = this.channel.loadError;
  readonly saving: Signal<boolean> = this.channel.saving;
  readonly saveError: Signal<boolean> = this.channel.saveError;

  /** The density of one table view; `normal` while the view has no stored density. */
  densityFor(view: TableViewId): Signal<TableDensity> {
    let density: Signal<TableDensity> | undefined = this.densityByView.get(view);
    if (!density) {
      density = computed((): TableDensity => this.channel.value()[view] ?? 'normal');
      this.densityByView.set(view, density);
    }
    return density;
  }

  save(view: TableViewId, density: TableDensity): void {
    this.channel.enqueue(
      // Deferred: the merge reads the map when this write's turn comes, after earlier writes.
      defer(() => {
        // Writing before the load answered would PUT a map missing the other views and erase them.
        if (!this.channel.loaded()) {
          throw new Error('Table densities are not loaded; refusing to overwrite the stored map');
        }
        const merged: TableDensities = { ...this.channel.value(), [view]: density };
        return this.api.saveTableDensities(merged).pipe(map((): TableDensities => merged));
      }),
    );
  }
}
