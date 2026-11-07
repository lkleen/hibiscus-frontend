import type { LauncherMode } from './args';

export interface MariadbConnection {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface BackendEnvParams {
  mode: LauncherMode;
  backendPort: number;
  proxySecret: string;
  credentialsKey: string;
  mariadb: MariadbConnection | undefined;
}

export const LOCAL_USER = 'local@localhost';
export const USER_HEADER = 'X-Forwarded-User';
export const SECRET_HEADER = 'X-Internal-Auth-Secret';

// Only what a Node child needs to run (esp. on Windows); nothing app-related is forwarded.
const PASSTHROUGH_VARS: readonly string[] = [
  'PATH',
  'HOME',
  'USERPROFILE',
  'SystemRoot',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'TMPDIR',
  'LANG',
];

export function buildBackendEnv(
  params: BackendEnvParams,
  baseEnv: NodeJS.ProcessEnv,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of PASSTHROUGH_VARS) {
    const value: string | undefined = baseEnv[name];
    if (value !== undefined) env[name] = value;
  }
  env['DATA_SOURCE'] = params.mode;
  env['PORT'] = String(params.backendPort);
  env['AUTH_HEADER_USER'] = USER_HEADER;
  env['ALLOWED_USERS'] = LOCAL_USER;
  env['INTERNAL_PROXY_SECRET'] = params.proxySecret;
  env['BANK_CREDENTIALS_KEY'] = params.credentialsKey;
  if (params.mode === 'mariadb') {
    const db: MariadbConnection | undefined = params.mariadb;
    if (!db) throw new Error('MariaDB connection details are required in mariadb mode');
    env['DB_HOST'] = db.host;
    env['DB_PORT'] = String(db.port);
    env['DB_NAME'] = db.database;
    env['DB_USER'] = db.user;
    env['DB_PASSWORD'] = db.password;
    env['ALLOWED_DB_HOSTS'] = `${db.host}:${db.port}`;
  }
  return env;
}
