import type { WithUserKey } from '@hibiscus-frontend/shared/contracts/sync';
import type { UserKeyStatus } from '@hibiscus-frontend/shared/contracts/user';
import type { Observable } from 'rxjs';

/** What the user typed into the key prompt. */
export interface KeyEntry {
  readonly key: string;
  readonly keepUnlocked: boolean;
}

/** Data passed to `Dialog.open`. `submit` runs the action; its failures decide what the prompt does. */
export interface KeyPromptData {
  /** `memory` mode: offer to keep the key in server memory afterwards. */
  readonly offerKeepUnlocked: boolean;
  readonly submit: (entry: KeyEntry) => Observable<unknown>;
}

/** How the prompt closed: the action succeeded, or failed with something other than a wrong key. */
export type KeyPromptResult =
  { readonly kind: 'done' } | { readonly kind: 'failed'; readonly failure: unknown };

/**
 * Whether an action that touches a PIN needs the key typed in now: always in `manual` mode, and in
 * `memory` mode while locked. An unknown status (not loaded yet) asks nothing; the backend's
 * `key-required` answer catches that case.
 */
export function promptNeeded(status: UserKeyStatus | null): boolean {
  return (
    status !== null &&
    status.configured &&
    (status.mode === 'manual' || (status.mode === 'memory' && status.state === 'locked'))
  );
}

/** Whether the prompt offers "keep unlocked": only `memory` mode keeps a key. */
export function offersKeepUnlocked(status: UserKeyStatus | null): boolean {
  return status !== null && status.mode === 'memory';
}

/** The request fields for a typed key; `keepUnlocked` is only sent when the prompt offered it. */
export function userKeyBodyOf(entry: KeyEntry, offerKeepUnlocked: boolean): WithUserKey {
  return offerKeepUnlocked
    ? { key: entry.key, keepUnlocked: entry.keepUnlocked }
    : { key: entry.key };
}
