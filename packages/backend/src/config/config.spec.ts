import { afterEach, describe, expect, it } from 'vitest';
import { formatAllowedDbHost, isDbHostAllowed, loadConfig } from './config';
import type { AllowedDbHost, Config } from './config';

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
  ALLOWED_DB_HOSTS: 'hibiscus-db',
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

describe('loadConfig ALLOWED_DB_HOSTS', () => {
  it('parses `host` and `host:port` entries, lower-cased and trimmed', () => {
    withEnv({ ALLOWED_DB_HOSTS: ' Hibiscus-DB , 10.0.0.5:3307,' });

    const config: Config = loadConfig();

    expect(config.ALLOWED_DB_HOSTS).toEqual([
      { host: 'hibiscus-db', port: null },
      { host: '10.0.0.5', port: 3307 },
    ]);
    expect(config.ALLOWED_DB_HOSTS.map(formatAllowedDbHost)).toEqual([
      'hibiscus-db',
      '10.0.0.5:3307',
    ]);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['only commas', ' , '],
    ['a port out of range', 'db:70000'],
    ['a port that is not a number', 'db:abc'],
    ['an entry with a space', 'my db'],
  ])('fails startup when it is %s', (_label: string, value: string | undefined) => {
    withEnv({ ALLOWED_DB_HOSTS: value });

    expect(() => loadConfig()).toThrow('Invalid environment variables');
  });
});

describe('isDbHostAllowed', () => {
  const allowed: AllowedDbHost[] = [
    { host: 'hibiscus-db', port: null },
    { host: '10.0.0.5', port: 3307 },
  ];

  it('matches the host exactly and case-insensitively, any port for a host-only entry', () => {
    expect(isDbHostAllowed(allowed, { host: 'HIBISCUS-DB', port: 3306 })).toBe(true);
    expect(isDbHostAllowed(allowed, { host: 'hibiscus-db', port: 1234 })).toBe(true);
  });

  it('matches the port when the entry names one', () => {
    expect(isDbHostAllowed(allowed, { host: '10.0.0.5', port: 3307 })).toBe(true);
    expect(isDbHostAllowed(allowed, { host: '10.0.0.5', port: 3306 })).toBe(false);
  });

  it.each(['hibiscus-db.evil.example', 'evil-hibiscus-db', 'hibiscus', '10.0.0.50', ''])(
    'rejects %j',
    (host: string) => {
      expect(isDbHostAllowed(allowed, { host, port: 3307 })).toBe(false);
    },
  );
});
