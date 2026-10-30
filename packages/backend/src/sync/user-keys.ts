import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { WithUserKey } from '@hibiscus-frontend/shared/contracts/sync';
import type {
  KeyMode,
  UserKeyChangeRequest,
  UserKeyCreateRequest,
  UserKeyModeRequest,
  UserKeyStatus,
} from '@hibiscus-frontend/shared/contracts/user';
import { currentUser } from '../db/pool';
import { whileReconfiguring } from '../db/user-activity';
import {
  createAppUserKey,
  deleteAppUserKey,
  getAppUserKey,
  updateAppUserKey,
} from '../repositories/app-user';
import type { AppUserKeyRecord } from '../repositories/app-user';
import {
  clearBankConnectionPins,
  reencryptBankConnectionPins,
} from '../repositories/bank-connection';
import { CredentialCrypto } from './credential-crypto';
import type { EncryptedSecret } from './credential-crypto';

/**
 * The user's own key, which encrypts their bank PINs (see `UserKeyStatus` / `KeyMode` in the
 * shared contract). The key is 32 random bytes, transported as base64; the app stores only an
 * HMAC check value of it and — in `stored` mode — a copy wrapped with the server key.
 *
 * Every `Buffer` holding a key that a method returns is owned by the caller, who zeroes it
 * (`fill(0)`) when done. No key or PIN is ever logged, returned (except a key the user just
 * created or changed to) or put into an error message.
 */

export const USER_KEY_BYTES = 32;
const KEY_CHECK_MESSAGE = 'hibiscus-frontend key check';
/** Base64 of exactly 32 bytes: 43 characters and one `=` of padding. */
const KEY_BASE64 = /^[A-Za-z0-9+/]{43}=$/;

/** The user has no key yet (`409 key-not-configured`). */
export class KeyNotConfiguredError extends Error {
  constructor() {
    super('No key is configured');
    this.name = 'KeyNotConfiguredError';
  }
}

/** The user has a key already (`409 key-configured`). */
export class KeyConfiguredError extends Error {
  constructor() {
    super('A key is configured already');
    this.name = 'KeyConfiguredError';
  }
}

/** The action needs the key in the request (`400 key-required`). */
export class KeyRequiredError extends Error {
  constructor() {
    super('The key is required');
    this.name = 'KeyRequiredError';
  }
}

/** The key is not base64 of 32 bytes, or does not match the check value (`400 key-invalid`). */
export class KeyInvalidError extends Error {
  constructor() {
    super('The key is invalid');
    this.name = 'KeyInvalidError';
  }
}

/** Unlocking is only possible in `memory` mode. */
export class KeyModeError extends Error {
  constructor(mode: KeyMode) {
    super(`Unlocking needs the memory key mode, the key is in ${mode} mode`);
    this.name = 'KeyModeError';
  }
}

/** Why scheduled syncs of a user can run (`ready`) or are skipped. */
export type UnattendedKeyState = 'ready' | 'not-configured' | 'manual' | 'locked';

export function generateUserKey(): Buffer {
  return randomBytes(USER_KEY_BYTES);
}

/** Decodes a key as the user enters it; throws `KeyInvalidError` unless base64 of 32 bytes. */
export function decodeUserKey(text: string): Buffer {
  const trimmed: string = text.trim();
  if (!KEY_BASE64.test(trimmed)) throw new KeyInvalidError();
  const key: Buffer = Buffer.from(trimmed, 'base64');
  if (key.length !== USER_KEY_BYTES) {
    key.fill(0);
    throw new KeyInvalidError();
  }
  return key;
}

export function encodeUserKey(key: Buffer): string {
  return key.toString('base64');
}

/** `HMAC-SHA256(key, "hibiscus-frontend key check")`, stored to verify an entered key. */
export function userKeyCheck(key: Buffer): Buffer {
  return createHmac('sha256', key).update(KEY_CHECK_MESSAGE).digest();
}

/** Whether `key` matches the stored check value, compared in constant time. */
export function matchesKeyCheck(key: Buffer, check: Buffer): boolean {
  const actual: Buffer = userKeyCheck(key);
  return actual.length === check.length && timingSafeEqual(actual, check);
}

/** Encrypts a PIN with the user's key; the key stays with the caller. */
export function encryptPin(key: Buffer, pin: string): EncryptedSecret {
  return new CredentialCrypto(key).encrypt(pin);
}

/** Decrypts a PIN with the user's key; throws a message without any secret on a wrong key. */
export function decryptPin(key: Buffer, pin: EncryptedSecret): string {
  try {
    return new CredentialCrypto(key).decrypt(pin);
  } catch {
    throw new Error('The stored PIN cannot be decrypted with the key; enter the PIN again');
  }
}

/** The keys of `memory`-mode users who unlocked, in server memory until lock or restart. */
export class UserKeyStore {
  private readonly keys: Map<string, Buffer> = new Map<string, Buffer>();

  has(username: string): boolean {
    return this.keys.has(username);
  }

  /** A copy the caller owns; `null` while locked. */
  get(username: string): Buffer | null {
    const key: Buffer | undefined = this.keys.get(username);
    return key === undefined ? null : Buffer.from(key);
  }

  /** Keeps a copy of `key`; the caller still owns (and zeroes) its own buffer. */
  set(username: string, key: Buffer): void {
    this.clear(username);
    this.keys.set(username, Buffer.from(key));
  }

  /** Zeroes and forgets the user's key. */
  clear(username: string): void {
    this.keys.get(username)?.fill(0);
    this.keys.delete(username);
  }
}

export interface UserKeysDeps {
  /** The server key instance; wraps the key in `stored` mode. */
  readonly serverCrypto: CredentialCrypto;
  readonly store: UserKeyStore;
}

/**
 * Resolves and manages each user's key. Every operation on one user's key runs after the previous
 * one of that user has finished, so e.g. a "lock" never interleaves with an unlock or a mode
 * switch. Changing and resetting the key touch the PINs in the user's database and run as the
 * user's exclusive reconfiguration (see `db/user-activity.ts`): refused while a sync runs, and no
 * sync starts meanwhile. They use the database of the current user context; a context without
 * one has no PINs to touch.
 */
export class UserKeys {
  private readonly queues: Map<string, Promise<void>> = new Map<string, Promise<void>>();

  constructor(private readonly deps: UserKeysDeps) {}

  async status(username: string): Promise<UserKeyStatus> {
    const record: AppUserKeyRecord | null = await getAppUserKey(username);
    if (record === null) return { configured: false, mode: null, state: 'not-applicable' };
    if (record.mode !== 'memory') {
      return { configured: true, mode: record.mode, state: 'not-applicable' };
    }
    return {
      configured: true,
      mode: 'memory',
      state: this.deps.store.has(username) ? 'unlocked' : 'locked',
    };
  }

  /**
   * The key for an action that encrypts or decrypts a PIN (see `WithUserKey`): `stored` unwraps
   * it, `memory` takes the unlocked one, else the entered one (kept when `keepUnlocked`), `manual`
   * the entered one. Throws `KeyNotConfiguredError`, `KeyRequiredError`, `KeyInvalidError`.
   */
  resolve(username: string, input: WithUserKey): Promise<Buffer> {
    return this.serialized(username, async (): Promise<Buffer> => {
      const record: AppUserKeyRecord = await this.requireKey(username);
      if (record.mode === 'stored') return this.unwrap(record);
      if (record.mode === 'memory') {
        const unlocked: Buffer | null = this.deps.store.get(username);
        if (unlocked !== null) return unlocked;
      }
      const entered: Buffer = this.checkEntered(record, input.key);
      if (record.mode === 'memory' && input.keepUnlocked === true) {
        this.deps.store.set(username, entered);
      }
      return entered;
    });
  }

  /** Whether a scheduled sync can get the key without the user. */
  async unattendedState(username: string): Promise<UnattendedKeyState> {
    const record: AppUserKeyRecord | null = await getAppUserKey(username);
    if (record === null) return 'not-configured';
    if (record.mode === 'manual') return 'manual';
    if (record.mode === 'memory' && !this.deps.store.has(username)) return 'locked';
    return 'ready';
  }

  /** The key without user input (`stored`, or `memory` while unlocked); else `KeyRequiredError`. */
  resolveUnattended(username: string): Promise<Buffer> {
    return this.resolve(username, {});
  }

  /** Sets the user's first key, generated unless given; returns it as base64 (shown once). */
  create(username: string, request: UserKeyCreateRequest): Promise<string> {
    return this.serialized(username, async (): Promise<string> => {
      const key: Buffer =
        request.key === undefined ? generateUserKey() : decodeUserKey(request.key);
      try {
        const created: boolean = await createAppUserKey(username, {
          mode: request.mode,
          check: userKeyCheck(key),
          wrapped: request.mode === 'stored' ? this.wrap(key) : null,
        });
        if (!created) throw new KeyConfiguredError();
        // The user has the key at hand right now: a new `memory` key starts unlocked.
        if (request.mode === 'memory') this.deps.store.set(username, key);
        return encodeUserKey(key);
      } finally {
        key.fill(0);
      }
    });
  }

  /**
   * Switches the mode. `stored` needs the key and wraps it; any other mode deletes the wrapped
   * copy. `memory` keeps the key unlocked when it is at hand (entered, the previously stored one,
   * or already unlocked); every other mode forgets the unlocked key.
   */
  setMode(username: string, request: UserKeyModeRequest): Promise<void> {
    return this.serialized(username, async (): Promise<void> => {
      const record: AppUserKeyRecord = await this.requireKey(username);
      const entered: Buffer | null =
        request.key === undefined ? null : this.checkEntered(record, request.key);
      let memoryKey: Buffer | null = null;
      try {
        if (request.mode === 'stored' && entered === null) throw new KeyRequiredError();
        if (request.mode === 'memory') memoryKey = this.keyAtHand(username, record, entered);
        await updateAppUserKey(username, {
          expectedCheck: record.check,
          next: {
            mode: request.mode,
            check: record.check,
            wrapped: request.mode === 'stored' && entered !== null ? this.wrap(entered) : null,
          },
        });
        if (memoryKey === null) this.deps.store.clear(username);
        else this.deps.store.set(username, memoryKey);
      } finally {
        entered?.fill(0);
        memoryKey?.fill(0);
      }
    });
  }

  /** Keeps the key in server memory (`memory` mode only). */
  unlock(username: string, key: string): Promise<void> {
    return this.serialized(username, async (): Promise<void> => {
      const record: AppUserKeyRecord = await this.requireKey(username);
      if (record.mode !== 'memory') throw new KeyModeError(record.mode);
      const entered: Buffer = this.checkEntered(record, key);
      try {
        this.deps.store.set(username, entered);
      } finally {
        entered.fill(0);
      }
    });
  }

  /** Forgets the unlocked key; a no-op when there is none. */
  lock(username: string): Promise<void> {
    return this.serialized(username, async (): Promise<void> => {
      this.deps.store.clear(username);
    });
  }

  /**
   * Re-encrypts every PIN under a new key (generated unless given) in one transaction and updates
   * the check value (and the wrapped copy in `stored` mode; the unlocked one in `memory` mode).
   * Returns the new key as base64. Throws `KeyInvalidError` for a wrong `oldKey` before touching
   * anything, `UserBusyError` while a sync runs.
   */
  change(username: string, request: UserKeyChangeRequest): Promise<string> {
    return this.serialized(username, () =>
      whileReconfiguring(username, async (): Promise<string> => {
        const record: AppUserKeyRecord = await this.requireKey(username);
        const oldKey: Buffer = this.checkEntered(record, request.oldKey);
        let newKey: Buffer | null = null;
        try {
          newKey = request.newKey === undefined ? generateUserKey() : decodeUserKey(request.newKey);
          const next: AppUserKeyRecord = {
            mode: record.mode,
            check: userKeyCheck(newKey),
            wrapped: record.mode === 'stored' ? this.wrap(newKey) : null,
          };
          await this.rekeyPins(username, { record, next, oldKey, newKey });
          if (this.deps.store.has(username)) this.deps.store.set(username, newKey);
          return encodeUserKey(newKey);
        } finally {
          oldKey.fill(0);
          newKey?.fill(0);
        }
      }),
    );
  }

  /**
   * Deletes every stored PIN (the connections are kept, disabled) and the key, for a user who
   * forgot it. `UserBusyError` while a sync runs.
   */
  reset(username: string): Promise<void> {
    return this.serialized(username, () =>
      whileReconfiguring(username, async (): Promise<void> => {
        if (currentUser().database !== null) await clearBankConnectionPins();
        await deleteAppUserKey(username);
        this.deps.store.clear(username);
      }),
    );
  }

  /**
   * Writes the PINs under the new key and the new key record. The key record is written right
   * before the PIN transaction commits; if the commit then fails, the old key record is restored,
   * so the check value always matches the key the PINs are under.
   */
  private async rekeyPins(
    username: string,
    change: {
      readonly record: AppUserKeyRecord;
      readonly next: AppUserKeyRecord;
      readonly oldKey: Buffer;
      readonly newKey: Buffer;
    },
  ): Promise<void> {
    const { record, next, oldKey, newKey } = change;
    const writeKey = (): Promise<void> =>
      updateAppUserKey(username, { expectedCheck: record.check, next });
    if (currentUser().database === null) {
      await writeKey();
      return;
    }
    let keyWritten = false;
    try {
      await reencryptBankConnectionPins({
        reencrypt: (pin: EncryptedSecret): EncryptedSecret =>
          encryptPin(newKey, decryptPin(oldKey, pin)),
        beforeCommit: async (): Promise<void> => {
          await writeKey();
          keyWritten = true;
        },
      });
    } catch (error: unknown) {
      if (!keyWritten) throw error;
      try {
        await updateAppUserKey(username, { expectedCheck: next.check, next: record });
      } catch (restoreError: unknown) {
        throw new AggregateError(
          [error, restoreError],
          `Changing the key of ${username} failed, and restoring the old check value failed too`,
        );
      }
      throw error;
    }
  }

  /** The key to keep unlocked when switching to `memory`, `null` when none is at hand. */
  private keyAtHand(
    username: string,
    record: AppUserKeyRecord,
    entered: Buffer | null,
  ): Buffer | null {
    if (entered !== null) return Buffer.from(entered);
    if (record.mode === 'stored') return this.unwrap(record);
    if (record.mode === 'memory') return this.deps.store.get(username);
    return null;
  }

  private async requireKey(username: string): Promise<AppUserKeyRecord> {
    const record: AppUserKeyRecord | null = await getAppUserKey(username);
    if (record === null) throw new KeyNotConfiguredError();
    return record;
  }

  /** The entered key, checked against the record; the caller owns the returned buffer. */
  private checkEntered(record: AppUserKeyRecord, text: string | undefined): Buffer {
    if (text === undefined) throw new KeyRequiredError();
    const key: Buffer = decodeUserKey(text);
    if (!matchesKeyCheck(key, record.check)) {
      key.fill(0);
      throw new KeyInvalidError();
    }
    return key;
  }

  private wrap(key: Buffer): EncryptedSecret {
    return this.deps.serverCrypto.encrypt(encodeUserKey(key));
  }

  /** The `stored`-mode key; a wrapped copy that is missing or does not match is a broken row. */
  private unwrap(record: AppUserKeyRecord): Buffer {
    if (record.wrapped === null) throw new Error('A stored key has no wrapped copy');
    const key: Buffer = decodeUserKey(this.deps.serverCrypto.decrypt(record.wrapped));
    if (!matchesKeyCheck(key, record.check)) {
      key.fill(0);
      throw new Error('The wrapped key does not match its check value');
    }
    return key;
  }

  /** Runs `work` after every earlier operation on the user's key has settled. */
  private serialized<T>(username: string, work: () => Promise<T>): Promise<T> {
    const previous: Promise<void> = this.queues.get(username) ?? Promise.resolve();
    const result: Promise<T> = previous.then(work);
    // The queue only orders the work; each caller gets its own result, rejection included.
    const tail: Promise<void> = result.then(
      (): void => undefined,
      (): void => undefined,
    );
    this.queues.set(username, tail);
    void tail.then((): void => {
      if (this.queues.get(username) === tail) this.queues.delete(username);
    });
    return result;
  }
}
