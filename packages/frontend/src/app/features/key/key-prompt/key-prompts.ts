import { Dialog, DialogRef } from '@angular/cdk/dialog';
import { Injectable, inject } from '@angular/core';
import type { WithUserKey } from '@hibiscus-frontend/shared/contracts/sync';
import type { UserKeyStatus } from '@hibiscus-frontend/shared/contracts/user';
import { Observable, catchError, switchMap, tap, throwError } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { userErrorOf } from '../../../core/utils/user-errors';
import {
  APP_DIALOG_BACKDROP_CLASS,
  APP_DIALOG_PANEL_CLASS,
} from '../../../shared/dialog/dialog-classes';
import { KEY_PROMPT_TITLE_ID, KeyPromptComponent } from './key-prompt.component';
import {
  offersKeepUnlocked,
  promptNeeded,
  userKeyBodyOf,
  type KeyEntry,
  type KeyPromptData,
  type KeyPromptResult,
} from './key-prompt.model';

export type { KeyEntry } from './key-prompt.model';

/**
 * Asks for the user's key before an action that encrypts or decrypts a PIN. The prompt runs the
 * action itself, so a wrong key (`400` `key-invalid`) keeps the dialog open with an error and the
 * user can retry.
 *
 * Every method returns an Observable that emits the action's result once, errors with the action's
 * own failure (anything but a wrong key), or completes without a value when the user cancels.
 */
@Injectable({ providedIn: 'root' })
export class KeyPrompts {
  private readonly dialog = inject(Dialog);
  private readonly api = inject(ApiService);

  /**
   * Runs `action`, asking for the key first when `status` says the mode needs it. When the status
   * was stale and the backend answers `key-required`, the prompt opens then.
   */
  run<T>(
    status: UserKeyStatus | null,
    action: (body: WithUserKey) => Observable<T>,
  ): Observable<T> {
    if (promptNeeded(status)) {
      const offer: boolean = offersKeepUnlocked(status);
      return this.ask(offer, (entry: KeyEntry) => action(userKeyBodyOf(entry, offer)));
    }
    return action({}).pipe(
      catchError((failure: unknown): Observable<T> => {
        if (userErrorOf(failure) !== 'key-required') return throwError(() => failure);
        return this.api.getUserKey().pipe(
          switchMap((fresh: UserKeyStatus): Observable<T> => {
            const offer: boolean = offersKeepUnlocked(fresh);
            return this.ask(offer, (entry: KeyEntry) => action(userKeyBodyOf(entry, offer)));
          }),
        );
      }),
    );
  }

  /** Always opens the prompt and runs `submit` with what was typed. */
  ask<T>(offerKeepUnlocked: boolean, submit: (entry: KeyEntry) => Observable<T>): Observable<T> {
    return new Observable<T>((subscriber) => {
      let outcome: { readonly value: T } | null = null;
      const data: KeyPromptData = {
        offerKeepUnlocked,
        submit: (entry: KeyEntry): Observable<T> =>
          submit(entry).pipe(
            tap((value: T): void => {
              outcome = { value };
            }),
          ),
      };
      const ref: DialogRef<KeyPromptResult | undefined> = this.dialog.open<
        KeyPromptResult | undefined,
        KeyPromptData
      >(KeyPromptComponent, {
        data,
        ariaLabelledBy: KEY_PROMPT_TITLE_ID,
        panelClass: APP_DIALOG_PANEL_CLASS,
        backdropClass: APP_DIALOG_BACKDROP_CLASS,
      });
      let closed = false;
      ref.closed.subscribe((result: KeyPromptResult | undefined): void => {
        closed = true;
        if (result?.kind === 'failed') {
          subscriber.error(result.failure);
          return;
        }
        if (result?.kind === 'done' && outcome !== null) subscriber.next(outcome.value);
        subscriber.complete();
      });
      return (): void => {
        if (!closed) ref.close();
      };
    });
  }
}
