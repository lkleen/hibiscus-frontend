import { DestroyRef, Injectable, Signal, inject } from '@angular/core';
import type { TaxProfile } from '@hibiscus-frontend/shared/contracts/user-settings';
import { map } from 'rxjs';
import { ApiService } from './api.service';
import { UserSettingChannel } from './user-setting-channel';

/**
 * The user's tax-return profile, shared app-wide and loaded once on construction. Writes go
 * through a serial queue and always PUT the whole profile; `profile` only changes once the server
 * confirmed.
 */
@Injectable({ providedIn: 'root' })
export class TaxProfileService {
  private readonly api = inject(ApiService);
  private readonly channel = new UserSettingChannel<TaxProfile | null>({
    load: () => this.api.getTaxProfile(),
    initial: null,
    label: 'tax profile',
    destroyRef: inject(DestroyRef),
  });

  /** `null` until the load answered; consumers wait for `loaded`. */
  readonly profile: Signal<TaxProfile | null> = this.channel.value;
  readonly loaded: Signal<boolean> = this.channel.loaded;
  readonly loadError: Signal<boolean> = this.channel.loadError;
  readonly saving: Signal<boolean> = this.channel.saving;
  readonly saveError: Signal<boolean> = this.channel.saveError;

  /** Saves the whole profile; it becomes `profile` once the server confirmed. */
  save(profile: TaxProfile): void {
    this.channel.enqueue(this.api.saveTaxProfile(profile).pipe(map((): TaxProfile => profile)));
  }
}
