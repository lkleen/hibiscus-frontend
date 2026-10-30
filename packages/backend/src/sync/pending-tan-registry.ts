import type { OpenTanChallenge, TanChallengeKind } from '@hibiscus-frontend/shared/contracts/sync';

/** A photoTAN image; held in memory only, never stored or logged. */
export interface ChallengeImage {
  readonly mimeType: string;
  readonly bytes: Buffer;
}

/** A TAN challenge as the FinTS session hands it over. */
export interface PendingChallenge {
  readonly kind: TanChallengeKind;
  readonly message: string;
  readonly image: ChallengeImage | null;
  /** The bank's order reference; the same reference across decoupled status polls. */
  readonly reference: string;
  /** Decoupled only: how long to wait before asking the bank again. */
  readonly pollDelayMs: number | null;
}

/**
 * How a FinTS session asks for a TAN. `request` resolves with the TAN, or with `undefined` for a
 * decoupled challenge when it is time to ask the bank for the approval status; it rejects with a
 * `TanTimeoutError` once the challenge has been open for the timeout. `settled` is called when the
 * order needs no further TAN.
 */
export interface TanPrompt {
  request(challenge: PendingChallenge): Promise<string | undefined>;
  settled(): Promise<void>;
}

/** Nobody answered a challenge in time. */
export class TanTimeoutError extends Error {
  constructor(runId: number) {
    super(`The TAN challenge of run ${runId} expired`);
    this.name = 'TanTimeoutError';
  }
}

export type TanAnswerResult = 'accepted' | 'no-challenge' | 'tan-required';

/** Where a run's prompt reports to. */
export interface PromptOwner {
  readonly runId: number;
  readonly connectionId: number;
}

interface Waiter {
  readonly resolve: (tan: string | undefined) => void;
  readonly timer: NodeJS.Timeout;
}

interface Entry {
  readonly connectionId: number;
  challenge: PendingChallenge;
  readonly deadline: number;
  waiter: Waiter | null;
}

/** Fifteen minutes, as the plan sets for an unanswered challenge. */
export const TAN_TIMEOUT_MS: number = 15 * 60 * 1000;

/**
 * The open TAN challenges, in process memory, keyed by run id: lib-fints keeps the open dialog in
 * memory and cannot save it, so a restart loses them (acceptable with a single container).
 *
 * A typed TAN or photoTAN waits for `answer`. A decoupled challenge resolves by itself after the
 * bank's poll delay so the session asks the bank again, until the bank reports the approval; an
 * `answer` makes it ask at once. A challenge's timeout counts from its first appearance, across
 * decoupled polls of the same order reference.
 */
export class PendingTanRegistry {
  private readonly entries: Map<number, Entry> = new Map<number, Entry>();

  constructor(private readonly timeoutMs: number) {}

  /** The prompt a run's FinTS session asks through. */
  createPrompt(owner: PromptOwner): TanPrompt {
    return {
      request: (challenge: PendingChallenge): Promise<string | undefined> =>
        this.request(owner, challenge),
      settled: async (): Promise<void> => this.release(owner.runId),
    };
  }

  /** Answers a run's open challenge. `tan` is ignored for a decoupled one. */
  answer(runId: number, tan: string | undefined): TanAnswerResult {
    const entry: Entry | undefined = this.entries.get(runId);
    if (entry === undefined || !this.isOpen(entry)) return 'no-challenge';
    if (entry.challenge.kind === 'decoupled') {
      // "I approved it": ask the bank now instead of after the poll delay.
      this.wake(entry, undefined);
      return 'accepted';
    }
    if (tan === undefined || tan.trim() === '') return 'tan-required';
    entry.challenge = { ...entry.challenge, image: null };
    this.wake(entry, tan.trim());
    return 'accepted';
  }

  /** A run's open challenge, without the image bytes. */
  openChallenge(runId: number): OpenTanChallenge | null {
    const entry: Entry | undefined = this.entries.get(runId);
    if (entry === undefined || !this.isOpen(entry)) return null;
    return {
      runId,
      kind: entry.challenge.kind,
      message: entry.challenge.message,
      hasImage: entry.challenge.image !== null,
    };
  }

  /** The open challenge of any run of a connection. */
  openChallengeOfConnection(connectionId: number): OpenTanChallenge | null {
    for (const [runId, entry] of this.entries) {
      if (entry.connectionId === connectionId && this.isOpen(entry)) {
        return this.openChallenge(runId);
      }
    }
    return null;
  }

  /** The image of a run's open challenge, `null` when there is none. */
  image(runId: number): ChallengeImage | null {
    const entry: Entry | undefined = this.entries.get(runId);
    if (entry === undefined || !this.isOpen(entry)) return null;
    return entry.challenge.image;
  }

  /** Forgets a run's challenge; its pending request, if any, is never resolved. */
  release(runId: number): void {
    const entry: Entry | undefined = this.entries.get(runId);
    if (entry?.waiter) clearTimeout(entry.waiter.timer);
    this.entries.delete(runId);
  }

  /** Waiting for an answer, or a decoupled challenge that is still being polled. */
  private isOpen(entry: Entry): boolean {
    return entry.waiter !== null || entry.challenge.kind === 'decoupled';
  }

  private wake(entry: Entry, tan: string | undefined): void {
    const waiter: Waiter | null = entry.waiter;
    if (waiter === null) return;
    clearTimeout(waiter.timer);
    entry.waiter = null;
    waiter.resolve(tan);
  }

  private request(owner: PromptOwner, challenge: PendingChallenge): Promise<string | undefined> {
    const previous: Entry | undefined = this.entries.get(owner.runId);
    if (previous?.waiter) {
      throw new Error(`Run ${owner.runId} already waits for a TAN`);
    }
    const now: number = Date.now();
    const deadline: number =
      previous !== undefined && previous.challenge.reference === challenge.reference
        ? previous.deadline
        : now + this.timeoutMs;
    if (now >= deadline) {
      this.entries.delete(owner.runId);
      return Promise.reject(new TanTimeoutError(owner.runId));
    }
    const entry: Entry = { connectionId: owner.connectionId, challenge, deadline, waiter: null };
    this.entries.set(owner.runId, entry);
    const remaining: number = deadline - now;
    const delay: number =
      challenge.kind === 'decoupled' ? Math.min(requirePollDelay(challenge), remaining) : remaining;
    return new Promise<string | undefined>(
      (resolve: (tan: string | undefined) => void, reject: (error: Error) => void): void => {
        const timer: NodeJS.Timeout = setTimeout((): void => {
          entry.waiter = null;
          if (Date.now() >= deadline) {
            this.entries.delete(owner.runId);
            reject(new TanTimeoutError(owner.runId));
            return;
          }
          resolve(undefined);
        }, delay);
        timer.unref();
        entry.waiter = { resolve, timer };
      },
    );
  }
}

function requirePollDelay(challenge: PendingChallenge): number {
  if (challenge.pollDelayMs === null) {
    throw new Error('A decoupled challenge needs a poll delay');
  }
  return challenge.pollDelayMs;
}
