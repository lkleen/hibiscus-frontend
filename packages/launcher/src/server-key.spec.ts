import { mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadOrCreateServerKey } from './server-key';

describe('loadOrCreateServerKey', () => {
  it('creates once with restrictive modes and reuses it', () => {
    const home: string = mkdtempSync(join(tmpdir(), 'launcher-'));
    const first: string = loadOrCreateServerKey(home);
    expect(Buffer.from(first, 'base64')).toHaveLength(32);
    const dir: string = join(home, '.hibiscus-frontend-local');
    if (process.platform !== 'win32') {
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      expect(statSync(join(dir, 'server-key')).mode & 0o777).toBe(0o600);
    }
    expect(loadOrCreateServerKey(home)).toBe(first);
  });

  it('throws on an invalid key file', () => {
    const home: string = mkdtempSync(join(tmpdir(), 'launcher-'));
    const dir: string = join(home, '.hibiscus-frontend-local');
    mkdirSync(dir);
    writeFileSync(join(dir, 'server-key'), 'too-short');
    expect(() => loadOrCreateServerKey(home)).toThrow(/base64/);
  });
});
