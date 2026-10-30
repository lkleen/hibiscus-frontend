import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserDatabaseHandle } from '../db/pool';

vi.mock('../db/pool', () => ({ currentUser: vi.fn() }));
vi.mock('../repositories/app-user', () => ({
  createAppUserKey: vi.fn(),
  deleteAppUserKey: vi.fn(),
  getAppUserKey: vi.fn(),
  updateAppUserKey: vi.fn(),
}));
vi.mock('../repositories/bank-connection', () => ({
  clearBankConnectionPins: vi.fn(),
  reencryptBankConnectionPins: vi.fn(),
}));

import { currentUser } from '../db/pool';
import { isReconfiguring, markUserBusy, unmarkUserBusy, UserBusyError } from '../db/user-activity';
import {
  createAppUserKey,
  deleteAppUserKey,
  getAppUserKey,
  updateAppUserKey,
} from '../repositories/app-user';
import type { AppUserKeyRecord, AppUserKeyUpdate } from '../repositories/app-user';
import {
  clearBankConnectionPins,
  reencryptBankConnectionPins,
} from '../repositories/bank-connection';
import type { PinReencryption } from '../repositories/bank-connection';
import { CredentialCrypto } from './credential-crypto';
import type { EncryptedSecret } from './credential-crypto';
import {
  decodeUserKey,
  decryptPin,
  encryptPin,
  KeyConfiguredError,
  KeyInvalidError,
  KeyModeError,
  KeyNotConfiguredError,
  KeyRequiredError,
  matchesKeyCheck,
  userKeyCheck,
  UserKeys,
  UserKeyStore,
} from './user-keys';

const USER = 'alice';
const PIN_A = 'pin-1111-secret';
const PIN_B = 'pin-2222-secret';

const serverCrypto: CredentialCrypto = new CredentialCrypto(randomBytes(32));

/** The fake app database row and the fake PINs in the user's database. */
let keyRow: AppUserKeyRecord | null;
let pins: Map<number, EncryptedSecret>;
let commitFails: boolean;
let store: UserKeyStore;
let keys: UserKeys;

function newKeyText(): string {
  return randomBytes(32).toString('base64');
}

function withDatabase(present: boolean): void {
  vi.mocked(currentUser).mockReturnValue({
    user: USER,
    database: present ? ({} as UserDatabaseHandle) : null,
  });
}

/** Sets a key up directly in the fake row, with two PINs encrypted under it. */
function configure(mode: AppUserKeyRecord['mode'], keyText: string): void {
  const key: Buffer = decodeUserKey(keyText);
  keyRow = {
    mode,
    check: userKeyCheck(key),
    wrapped: mode === 'stored' ? serverCrypto.encrypt(keyText) : null,
  };
  pins = new Map<number, EncryptedSecret>([
    [1, encryptPin(key, PIN_A)],
    [2, encryptPin(key, PIN_B)],
  ]);
}

function pinsUnder(keyText: string): string[] {
  const key: Buffer = decodeUserKey(keyText);
  return [...pins.values()].map((pin: EncryptedSecret) => decryptPin(key, pin));
}

beforeEach(() => {
  vi.resetAllMocks();
  keyRow = null;
  pins = new Map<number, EncryptedSecret>();
  commitFails = false;
  store = new UserKeyStore();
  keys = new UserKeys({ serverCrypto, store });
  withDatabase(true);
  vi.mocked(getAppUserKey).mockImplementation(async () => keyRow);
  vi.mocked(createAppUserKey).mockImplementation(
    async (_user: string, record: AppUserKeyRecord) => {
      if (keyRow !== null) return false;
      keyRow = record;
      return true;
    },
  );
  vi.mocked(updateAppUserKey).mockImplementation(
    async (_user: string, update: AppUserKeyUpdate) => {
      if (keyRow === null || !keyRow.check.equals(update.expectedCheck)) {
        throw new Error('The key changed');
      }
      keyRow = update.next;
    },
  );
  vi.mocked(deleteAppUserKey).mockImplementation(async () => {
    keyRow = null;
  });
  // A transaction: the new PINs only replace the old ones when everything succeeded.
  vi.mocked(reencryptBankConnectionPins).mockImplementation(async (params: PinReencryption) => {
    const next: Map<number, EncryptedSecret> = new Map<number, EncryptedSecret>();
    for (const [id, pin] of pins) next.set(id, params.reencrypt(pin));
    await params.beforeCommit();
    if (commitFails) throw new Error('commit failed');
    pins = next;
    return next.size;
  });
  vi.mocked(clearBankConnectionPins).mockImplementation(async () => {
    const count: number = pins.size;
    pins.clear();
    return count;
  });
});

describe('key encoding and check value', () => {
  it('decodes base64 of exactly 32 bytes, ignoring surrounding whitespace', () => {
    const key: Buffer = randomBytes(32);

    expect(decodeUserKey(` ${key.toString('base64')}\n`).equals(key)).toBe(true);
  });

  it.each([
    ['16 bytes', randomBytes(16).toString('base64')],
    ['33 bytes', randomBytes(33).toString('base64')],
    ['not base64', '!'.repeat(43) + '='],
    ['base64url', 'A'.repeat(42) + '_-'],
    ['empty', ''],
  ])('rejects %s as key-invalid', (_label: string, text: string) => {
    expect(() => decodeUserKey(text)).toThrow(KeyInvalidError);
  });

  it('checks a key against its HMAC check value', () => {
    const key: Buffer = randomBytes(32);
    const check: Buffer = userKeyCheck(key);

    expect(check).toHaveLength(32);
    expect(matchesKeyCheck(key, check)).toBe(true);
    expect(matchesKeyCheck(randomBytes(32), check)).toBe(false);
    expect(matchesKeyCheck(key, check.subarray(0, 16))).toBe(false);
  });
});

describe('UserKeyStore', () => {
  it('hands out copies and zeroes the key on clear', () => {
    const key: Buffer = randomBytes(32);
    store.set(USER, key);
    const copy: Buffer | null = store.get(USER);
    copy?.fill(0);

    expect(store.get(USER)?.equals(key)).toBe(true);
    const kept: Buffer = (store as unknown as { keys: Map<string, Buffer> }).keys.get(USER)!;
    store.clear(USER);
    expect(kept.every((byte: number) => byte === 0)).toBe(true);
    expect(store.has(USER)).toBe(false);
  });
});

describe('UserKeys.create', () => {
  it('generates a key, stores only its check value and returns it once', async () => {
    const text: string = await keys.create(USER, { mode: 'manual' });

    const key: Buffer = decodeUserKey(text);
    expect(keyRow).toEqual({ mode: 'manual', check: userKeyCheck(key), wrapped: null });
    expect(store.has(USER)).toBe(false);
    expect(await keys.status(USER)).toEqual({
      configured: true,
      mode: 'manual',
      state: 'not-applicable',
    });
  });

  it('takes the user’s own key, wraps it in stored mode and unlocks it in memory mode', async () => {
    const own: string = newKeyText();

    expect(await keys.create(USER, { key: own, mode: 'stored' })).toBe(own);
    expect(serverCrypto.decrypt(keyRow!.wrapped!)).toBe(own);
    expect(JSON.stringify(keyRow)).not.toContain(own);

    keyRow = null;
    await keys.create(USER, { key: own, mode: 'memory' });
    expect(keyRow!.wrapped).toBeNull();
    expect(await keys.status(USER)).toEqual({
      configured: true,
      mode: 'memory',
      state: 'unlocked',
    });
  });

  it('refuses a second key and an invalid one', async () => {
    await keys.create(USER, { mode: 'manual' });
    const first: AppUserKeyRecord | null = keyRow;

    await expect(keys.create(USER, { mode: 'stored' })).rejects.toBeInstanceOf(KeyConfiguredError);
    expect(keyRow).toBe(first);

    keyRow = null;
    await expect(keys.create(USER, { key: 'short', mode: 'manual' })).rejects.toBeInstanceOf(
      KeyInvalidError,
    );
    expect(keyRow).toBeNull();
  });
});

describe('UserKeys.resolve per mode', () => {
  it('answers key-not-configured without a key', async () => {
    await expect(keys.resolve(USER, {})).rejects.toBeInstanceOf(KeyNotConfiguredError);
    expect(await keys.status(USER)).toEqual({
      configured: false,
      mode: null,
      state: 'not-applicable',
    });
  });

  it('manual: needs the entered key and checks it, keeping nothing', async () => {
    const text: string = newKeyText();
    configure('manual', text);

    await expect(keys.resolve(USER, {})).rejects.toBeInstanceOf(KeyRequiredError);
    await expect(keys.resolve(USER, { key: newKeyText() })).rejects.toBeInstanceOf(KeyInvalidError);
    const key: Buffer = await keys.resolve(USER, { key: text, keepUnlocked: true });
    expect(key.toString('base64')).toBe(text);
    expect(store.has(USER)).toBe(false);
    expect(await keys.unattendedState(USER)).toBe('manual');
    await expect(keys.resolveUnattended(USER)).rejects.toBeInstanceOf(KeyRequiredError);
  });

  it('memory: takes the unlocked key, else the entered one, kept only when asked', async () => {
    const text: string = newKeyText();
    configure('memory', text);

    expect(await keys.unattendedState(USER)).toBe('locked');
    await expect(keys.resolveUnattended(USER)).rejects.toBeInstanceOf(KeyRequiredError);
    await expect(keys.resolve(USER, {})).rejects.toBeInstanceOf(KeyRequiredError);
    await keys.resolve(USER, { key: text });
    expect(store.has(USER)).toBe(false);

    await keys.resolve(USER, { key: text, keepUnlocked: true });
    expect(await keys.status(USER)).toEqual({
      configured: true,
      mode: 'memory',
      state: 'unlocked',
    });
    expect(await keys.unattendedState(USER)).toBe('ready');

    const resolved: Buffer = await keys.resolveUnattended(USER);
    expect(resolved.toString('base64')).toBe(text);
    resolved.fill(0);
    // The caller zeroing its copy leaves the unlocked key intact.
    expect((await keys.resolve(USER, {})).toString('base64')).toBe(text);
  });

  it('stored: unwraps the key with the server key, without input', async () => {
    const text: string = newKeyText();
    configure('stored', text);

    expect(await keys.unattendedState(USER)).toBe('ready');
    expect((await keys.resolveUnattended(USER)).toString('base64')).toBe(text);
  });

  it('stored: throws for a wrapped key that does not match the check value', async () => {
    configure('stored', newKeyText());
    keyRow = { ...keyRow!, wrapped: serverCrypto.encrypt(newKeyText()) };

    await expect(keys.resolveUnattended(USER)).rejects.toThrow('does not match');
  });
});

describe('UserKeys.setMode, unlock and lock', () => {
  it('needs and checks the key to switch to stored, and wraps it', async () => {
    const text: string = newKeyText();
    configure('manual', text);

    await expect(keys.setMode(USER, { mode: 'stored' })).rejects.toBeInstanceOf(KeyRequiredError);
    await expect(keys.setMode(USER, { mode: 'stored', key: newKeyText() })).rejects.toBeInstanceOf(
      KeyInvalidError,
    );
    expect(keyRow!.mode).toBe('manual');

    await keys.setMode(USER, { mode: 'stored', key: text });
    expect(keyRow!.mode).toBe('stored');
    expect(serverCrypto.decrypt(keyRow!.wrapped!)).toBe(text);
  });

  it('deletes the wrapped copy when leaving stored, keeping the key unlocked in memory', async () => {
    const text: string = newKeyText();
    configure('stored', text);

    await keys.setMode(USER, { mode: 'memory' });

    expect(keyRow).toMatchObject({ mode: 'memory', wrapped: null });
    expect(await keys.status(USER)).toMatchObject({ state: 'unlocked' });

    await keys.setMode(USER, { mode: 'manual' });
    expect(keyRow).toMatchObject({ mode: 'manual', wrapped: null });
    expect(store.has(USER)).toBe(false);

    await keys.setMode(USER, { mode: 'memory' });
    expect(await keys.status(USER)).toMatchObject({ mode: 'memory', state: 'locked' });
  });

  it('unlocks only in memory mode and with the right key, and locks again', async () => {
    const text: string = newKeyText();
    configure('manual', text);
    await expect(keys.unlock(USER, text)).rejects.toBeInstanceOf(KeyModeError);

    configure('memory', text);
    await expect(keys.unlock(USER, newKeyText())).rejects.toBeInstanceOf(KeyInvalidError);
    expect(store.has(USER)).toBe(false);
    await keys.unlock(USER, text);
    expect(store.has(USER)).toBe(true);
    await keys.lock(USER);
    expect(store.has(USER)).toBe(false);
  });

  it('runs one user’s key operations in order', async () => {
    const text: string = newKeyText();
    configure('memory', text);

    await Promise.all([keys.unlock(USER, text), keys.lock(USER)]);

    expect(store.has(USER)).toBe(false);
  });
});

describe('UserKeys.change', () => {
  it('re-encrypts every PIN under the new key and replaces the check value', async () => {
    const oldText: string = newKeyText();
    configure('manual', oldText);

    const newText: string = await keys.change(USER, { oldKey: oldText });

    expect(newText).not.toBe(oldText);
    expect(pinsUnder(newText)).toEqual([PIN_A, PIN_B]);
    expect(matchesKeyCheck(decodeUserKey(newText), keyRow!.check)).toBe(true);
    expect(isReconfiguring(USER)).toBe(false);
  });

  it('re-wraps a stored key and replaces an unlocked memory key', async () => {
    const oldText: string = newKeyText();
    const newText: string = newKeyText();
    configure('stored', oldText);
    expect(await keys.change(USER, { oldKey: oldText, newKey: newText })).toBe(newText);
    expect(serverCrypto.decrypt(keyRow!.wrapped!)).toBe(newText);

    configure('memory', oldText);
    await keys.unlock(USER, oldText);
    await keys.change(USER, { oldKey: oldText, newKey: newText });
    expect((await keys.resolveUnattended(USER)).toString('base64')).toBe(newText);
  });

  it('answers a wrong old key with key-invalid and touches no PIN', async () => {
    const oldText: string = newKeyText();
    configure('manual', oldText);
    const before: Map<number, EncryptedSecret> = pins;
    const row: AppUserKeyRecord | null = keyRow;

    await expect(keys.change(USER, { oldKey: newKeyText() })).rejects.toBeInstanceOf(
      KeyInvalidError,
    );

    expect(reencryptBankConnectionPins).not.toHaveBeenCalled();
    expect(pins).toBe(before);
    expect(keyRow).toBe(row);
  });

  it('keeps every PIN and the old check value when the commit fails', async () => {
    const oldText: string = newKeyText();
    configure('manual', oldText);
    const row: AppUserKeyRecord | null = keyRow;
    commitFails = true;

    await expect(keys.change(USER, { oldKey: oldText })).rejects.toThrow('commit failed');

    expect(pinsUnder(oldText)).toEqual([PIN_A, PIN_B]);
    expect(keyRow).toEqual(row);
    expect(isReconfiguring(USER)).toBe(false);
  });

  it('keeps everything when one PIN is not under the old key', async () => {
    const oldText: string = newKeyText();
    configure('manual', oldText);
    pins.set(3, encryptPin(randomBytes(32), 'foreign'));
    const row: AppUserKeyRecord | null = keyRow;

    await expect(keys.change(USER, { oldKey: oldText })).rejects.toThrow('cannot be decrypted');

    const oldKey: Buffer = decodeUserKey(oldText);
    expect([decryptPin(oldKey, pins.get(1)!), decryptPin(oldKey, pins.get(2)!)]).toEqual([
      PIN_A,
      PIN_B,
    ]);
    expect(keyRow).toBe(row);
  });

  it('refuses while a sync runs, and blocks syncs while it runs', async () => {
    const oldText: string = newKeyText();
    configure('manual', oldText);
    markUserBusy(USER);
    try {
      await expect(keys.change(USER, { oldKey: oldText })).rejects.toBeInstanceOf(UserBusyError);
      await expect(keys.reset(USER)).rejects.toBeInstanceOf(UserBusyError);
    } finally {
      unmarkUserBusy(USER);
    }
    expect(reencryptBankConnectionPins).not.toHaveBeenCalled();
    expect(pins.size).toBe(2);

    let syncRefused = false;
    vi.mocked(reencryptBankConnectionPins).mockImplementationOnce(async () => {
      syncRefused = (() => {
        try {
          markUserBusy(USER);
          unmarkUserBusy(USER);
          return false;
        } catch (error: unknown) {
          return error instanceof UserBusyError;
        }
      })();
      return 0;
    });
    await keys.change(USER, { oldKey: oldText });
    expect(syncRefused).toBe(true);
  });

  it('only replaces the key record for a user without a database', async () => {
    withDatabase(false);
    const oldText: string = newKeyText();
    configure('manual', oldText);

    const newText: string = await keys.change(USER, { oldKey: oldText });

    expect(reencryptBankConnectionPins).not.toHaveBeenCalled();
    expect(matchesKeyCheck(decodeUserKey(newText), keyRow!.check)).toBe(true);
  });
});

describe('UserKeys.reset', () => {
  it('deletes every PIN and the key, and locks', async () => {
    const text: string = newKeyText();
    configure('memory', text);
    await keys.unlock(USER, text);

    await keys.reset(USER);

    expect(pins.size).toBe(0);
    expect(keyRow).toBeNull();
    expect(store.has(USER)).toBe(false);
    expect(isReconfiguring(USER)).toBe(false);
    expect(await keys.status(USER)).toEqual({
      configured: false,
      mode: null,
      state: 'not-applicable',
    });
  });
});
