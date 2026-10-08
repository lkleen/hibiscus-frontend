import { DestroyRef, Injectable, Signal, effect, inject } from '@angular/core';
import type { TableDensity } from '@hibiscus-frontend/shared/contracts/user-settings';
import { map } from 'rxjs';
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

const CLASS_PREFIX = 'table-density-';

/**
 * The user's table density, shared app-wide and loaded once on construction. Keeps exactly one
 * `table-density-<id>` class on `<html>` (none until the load answers) which the table styles read.
 * Writes go through a serial queue; `density` only changes once the server confirmed.
 */
@Injectable({ providedIn: 'root' })
export class TableDensityService {
  private readonly api = inject(ApiService);
  private readonly channel = new UserSettingChannel<TableDensity>({
    load: () => this.api.getTableDensity(),
    initial: 'normal',
    label: 'table density',
    destroyRef: inject(DestroyRef),
  });

  readonly density: Signal<TableDensity> = this.channel.value;
  readonly loaded: Signal<boolean> = this.channel.loaded;
  readonly loadError: Signal<boolean> = this.channel.loadError;
  readonly saving: Signal<boolean> = this.channel.saving;
  readonly saveError: Signal<boolean> = this.channel.saveError;

  constructor() {
    effect(() => {
      if (!this.loaded()) return;
      const active = `${CLASS_PREFIX}${this.density()}`;
      const classList: DOMTokenList = document.documentElement.classList;
      for (const id of TABLE_DENSITIES) {
        if (`${CLASS_PREFIX}${id}` !== active) classList.remove(`${CLASS_PREFIX}${id}`);
      }
      classList.add(active);
    });
  }

  save(density: TableDensity): void {
    this.channel.enqueue(this.api.saveTableDensity(density).pipe(map(() => density)));
  }
}
