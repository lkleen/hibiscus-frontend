import type {
  UserDatabase,
  UserDatabaseTestRequest,
  UserDatabaseUpdateRequest,
} from '@hibiscus-frontend/shared/contracts/user';

/** The form's fields as typed. */
export interface DatabaseDraft {
  readonly host: string;
  readonly port: string;
  readonly name: string;
  readonly user: string;
  readonly password: string;
}

export type DatabaseField = keyof DatabaseDraft;
export type DatabaseProblem = 'host' | 'port' | 'name' | 'user' | 'password';

export const DEFAULT_DATABASE_PORT = '3306';

export function draftOfDatabase(database: UserDatabase | null): DatabaseDraft {
  return {
    host: database?.host ?? '',
    port: database === null ? DEFAULT_DATABASE_PORT : String(database.port),
    name: database?.name ?? '',
    user: database?.user ?? '',
    password: '',
  };
}

/**
 * An `ALLOWED_DB_HOSTS` entry is `host` or `host:port`. Picking one with a port sets both fields;
 * anything else is just a host.
 */
export function splitHostEntry(entry: string): {
  readonly host: string;
  readonly port: string | null;
} {
  const separator: number = entry.lastIndexOf(':');
  if (separator <= 0) return { host: entry, port: null };
  const port: string = entry.slice(separator + 1);
  return /^\d+$/.test(port)
    ? { host: entry.slice(0, separator), port }
    : { host: entry, port: null };
}

/** Whether `value` is one of the allowed entries, so a pick from the list can fill the port. */
export function isAllowedEntry(value: string, allowedHosts: readonly string[]): boolean {
  return allowedHosts.includes(value);
}

/** The fields that block saving or testing. The password is only required until one is stored. */
export function databaseProblems(draft: DatabaseDraft, passwordSet: boolean): DatabaseProblem[] {
  const problems: DatabaseProblem[] = [];
  if (draft.host.trim() === '') problems.push('host');
  const port = Number(draft.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push('port');
  if (draft.name.trim() === '') problems.push('name');
  if (draft.user.trim() === '') problems.push('user');
  if (draft.password === '' && !passwordSet) problems.push('password');
  return problems;
}

/** The request body; an empty password is left out, which keeps the stored one. */
export function databaseRequestOf(
  draft: DatabaseDraft,
): UserDatabaseUpdateRequest & UserDatabaseTestRequest {
  return {
    host: draft.host.trim(),
    port: Number(draft.port),
    name: draft.name.trim(),
    user: draft.user.trim(),
    ...(draft.password === '' ? {} : { password: draft.password }),
  };
}
