import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const KEY_BYTES = 32;

export function generateKey(): string {
  return randomBytes(KEY_BYTES).toString('base64');
}

function assertValidKey(key: string, file: string): void {
  if (
    Buffer.from(key, 'base64').length !== KEY_BYTES ||
    Buffer.from(key, 'base64').toString('base64') !== key
  ) {
    throw new Error(`${file} is not a base64-encoded ${KEY_BYTES}-byte key. Fix or delete it.`);
  }
}

/** Persisted key for MariaDB mode: it encrypts the stored database password. */
export function loadOrCreateServerKey(homeDir: string): string {
  const dir: string = join(homeDir, '.hibiscus-frontend-local');
  const file: string = join(dir, 'server-key');
  if (existsSync(file)) {
    const existing: string = readFileSync(file, 'utf8').trim();
    assertValidKey(existing, file);
    return existing;
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const key: string = generateKey();
  writeFileSync(file, `${key}\n`, { mode: 0o600, flag: 'wx' });
  chmodSync(file, 0o600);
  return key;
}
