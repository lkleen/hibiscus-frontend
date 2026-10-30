/**
 * What each user has in flight, so work that must not overlap is refused (`409 busy`):
 *
 * - **busy** — counted per run: a sync, a discovery, or a write of a newly encrypted PIN;
 * - **reconfiguring** — exclusive: the user's database settings or key are being changed (saving
 *   the database, changing or resetting the key).
 *
 * A user who is reconfiguring cannot be marked busy, and a busy user cannot start reconfiguring.
 * Every check and the mark it guards happen in the same synchronous turn, so two requests can never
 * both pass the check. The registry is in-process: the app runs as one process.
 */

/** The user has a run in progress, or is reconfiguring their database or key. */
export class UserBusyError extends Error {
  constructor(readonly user: string) {
    super(`The user ${user} has a sync or a reconfiguration in progress`);
    this.name = 'UserBusyError';
  }
}

const busyRuns: Map<string, number> = new Map<string, number>();
const reconfiguring: Set<string> = new Set<string>();

/** Marks one more run of the user; throws `UserBusyError` while the user is reconfiguring. */
export function markUserBusy(username: string): void {
  if (reconfiguring.has(username)) throw new UserBusyError(username);
  busyRuns.set(username, (busyRuns.get(username) ?? 0) + 1);
}

/** Throws when the user was not marked: an unbalanced unmark is a bug. */
export function unmarkUserBusy(username: string): void {
  const runs: number | undefined = busyRuns.get(username);
  if (runs === undefined) throw new Error(`The user ${username} is not marked busy`);
  if (runs === 1) busyRuns.delete(username);
  else busyRuns.set(username, runs - 1);
}

export function isUserBusy(username: string): boolean {
  return busyRuns.has(username);
}

/** Starts the user's exclusive reconfiguration; throws `UserBusyError` while busy or already. */
export function beginReconfiguring(username: string): void {
  if (busyRuns.has(username) || reconfiguring.has(username)) throw new UserBusyError(username);
  reconfiguring.add(username);
}

/** Throws when the user was not reconfiguring: an unbalanced end is a bug. */
export function endReconfiguring(username: string): void {
  if (!reconfiguring.delete(username)) {
    throw new Error(`The user ${username} is not reconfiguring`);
  }
}

export function isReconfiguring(username: string): boolean {
  return reconfiguring.has(username);
}

/** Runs `work` as one run of the user (see `markUserBusy`). */
export async function whileUserBusy<T>(username: string, work: () => Promise<T>): Promise<T> {
  markUserBusy(username);
  try {
    return await work();
  } finally {
    unmarkUserBusy(username);
  }
}

/** Runs `work` as the user's exclusive reconfiguration (see `beginReconfiguring`). */
export async function whileReconfiguring<T>(username: string, work: () => Promise<T>): Promise<T> {
  beginReconfiguring(username);
  try {
    return await work();
  } finally {
    endReconfiguring(username);
  }
}
