import { describe, expect, it } from 'vitest';
import { buildBackendEnv } from './env';

const base: NodeJS.ProcessEnv = { PATH: '/bin', HOME: '/h', DB_PASSWORD: 'leak', SECRET: 'x' };

describe('buildBackendEnv', () => {
  it('builds the demo env without DB vars or unrelated vars', () => {
    const env: Record<string, string> = buildBackendEnv(
      {
        mode: 'demo',
        backendPort: 4000,
        proxySecret: 's',
        credentialsKey: 'k',
        mariadb: undefined,
      },
      base,
    );
    expect(env).toEqual({
      PATH: '/bin',
      HOME: '/h',
      DATA_SOURCE: 'demo',
      PORT: '4000',
      AUTH_HEADER_USER: 'X-Forwarded-User',
      ALLOWED_USERS: 'local@localhost',
      INTERNAL_PROXY_SECRET: 's',
      BANK_CREDENTIALS_KEY: 'k',
    });
  });

  it('adds the DB vars in mariadb mode', () => {
    const env: Record<string, string> = buildBackendEnv(
      {
        mode: 'mariadb',
        backendPort: 4000,
        proxySecret: 's',
        credentialsKey: 'k',
        mariadb: { host: 'db', port: 3307, database: 'h', user: 'u', password: 'p' },
      },
      {},
    );
    expect(env).toMatchObject({
      DATA_SOURCE: 'mariadb',
      DB_HOST: 'db',
      DB_PORT: '3307',
      DB_NAME: 'h',
      DB_USER: 'u',
      DB_PASSWORD: 'p',
      ALLOWED_DB_HOSTS: 'db:3307',
    });
  });

  it('throws without connection details in mariadb mode', () => {
    expect(() =>
      buildBackendEnv(
        {
          mode: 'mariadb',
          backendPort: 1,
          proxySecret: 's',
          credentialsKey: 'k',
          mariadb: undefined,
        },
        {},
      ),
    ).toThrow();
  });
});
