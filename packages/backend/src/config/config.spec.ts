import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config';
import type { Config } from './config';

const BASE_ENV: Record<string, string> = {
  DB_HOST: 'localhost',
  DB_PORT: '3306',
  DB_NAME: 'hibiscus',
  DB_USER: 'hibiscus',
  DB_PASSWORD: 'password',
  PORT: '3000',
  AUTH_HEADER_USER: 'X-Forwarded-User',
  ALLOWED_USERS: 'alice@example.com',
  INTERNAL_PROXY_SECRET: 'secret',
  BANK_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString('base64'),
};

const originalEnv: NodeJS.ProcessEnv = process.env;

function withEnv(overrides: Record<string, string | undefined>): void {
  const env: Record<string, string | undefined> = { ...BASE_ENV, ...overrides };
  process.env = Object.fromEntries(
    Object.entries(env).filter((entry: [string, string | undefined]) => entry[1] !== undefined),
  );
}

afterEach(() => {
  process.env = originalEnv;
});

describe('loadConfig bank sync values', () => {
  it('decodes the 32-byte credential key', () => {
    withEnv({});

    const config: Config = loadConfig();

    expect(config.BANK_CREDENTIALS_KEY.equals(Buffer.alloc(32, 7))).toBe(true);
  });

  it.each([
    ['BANK_CREDENTIALS_KEY missing', { BANK_CREDENTIALS_KEY: undefined }],
    ['BANK_CREDENTIALS_KEY not base64', { BANK_CREDENTIALS_KEY: 'not base64!' }],
    [
      'BANK_CREDENTIALS_KEY 16 bytes',
      { BANK_CREDENTIALS_KEY: Buffer.alloc(16).toString('base64') },
    ],
  ])('fails startup when %s', (_label: string, overrides: Record<string, string | undefined>) => {
    withEnv(overrides);

    expect(() => loadConfig()).toThrow('Invalid environment variables');
  });
});
