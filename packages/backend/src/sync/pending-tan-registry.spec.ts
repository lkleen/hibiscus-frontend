import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PendingTanRegistry, TanTimeoutError } from './pending-tan-registry';
import type { PendingChallenge, TanPrompt } from './pending-tan-registry';

const TIMEOUT_MS = 15 * 60 * 1000;

const tanChallenge: PendingChallenge = {
  kind: 'tan',
  message: 'Bitte TAN eingeben',
  image: null,
  reference: 'ref-1',
  pollDelayMs: null,
};
const photoChallenge: PendingChallenge = {
  ...tanChallenge,
  kind: 'phototan',
  image: { mimeType: 'image/png', bytes: Buffer.from([1, 2, 3]) },
};
const decoupledChallenge: PendingChallenge = {
  ...tanChallenge,
  kind: 'decoupled',
  message: 'Bitte in der App freigeben',
  pollDelayMs: 5000,
};

let registry: PendingTanRegistry;
let prompt: TanPrompt;

beforeEach(() => {
  vi.useFakeTimers();
  registry = new PendingTanRegistry(TIMEOUT_MS);
  prompt = registry.createPrompt({ runId: 7, connectionId: 3 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PendingTanRegistry with a typed TAN', () => {
  it('resolves the request with the answered TAN, trimmed', async () => {
    const answer: Promise<string | undefined> = prompt.request(tanChallenge);

    expect(registry.openChallenge(7)).toEqual({
      runId: 7,
      kind: 'tan',
      message: 'Bitte TAN eingeben',
      hasImage: false,
    });
    expect(registry.openChallengeOfConnection(3)?.runId).toBe(7);
    expect(registry.answer(7, ' 123456 ')).toBe('accepted');
    await expect(answer).resolves.toBe('123456');
    expect(registry.openChallenge(7)).toBeNull();
  });

  it('demands a TAN and keeps waiting without one', async () => {
    const answer: Promise<string | undefined> = prompt.request(tanChallenge);

    expect(registry.answer(7, undefined)).toBe('tan-required');
    expect(registry.answer(7, '  ')).toBe('tan-required');
    expect(registry.openChallenge(7)).not.toBeNull();
    registry.answer(7, '1');
    await answer;
  });

  it('answers no-challenge for an unknown run and after the answer', async () => {
    expect(registry.answer(99, '1')).toBe('no-challenge');
    const answer: Promise<string | undefined> = prompt.request(tanChallenge);
    registry.answer(7, '1');
    await answer;

    expect(registry.answer(7, '2')).toBe('no-challenge');
  });

  it('times out after 15 minutes and forgets the challenge', async () => {
    const answer: Promise<string | undefined> = prompt.request(tanChallenge);
    const outcome: Promise<unknown> = answer.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);

    expect(await outcome).toBeInstanceOf(TanTimeoutError);
    expect(registry.openChallenge(7)).toBeNull();
    expect(registry.answer(7, '1')).toBe('no-challenge');
  });

  it('refuses a second request while the first still waits', () => {
    void prompt.request(tanChallenge);

    expect(() => prompt.request(tanChallenge)).toThrow('already waits');
  });
});

describe('PendingTanRegistry with a photoTAN', () => {
  it('serves the image while open and drops it once answered', async () => {
    const answer: Promise<string | undefined> = prompt.request(photoChallenge);

    expect(registry.openChallenge(7)?.hasImage).toBe(true);
    expect(registry.image(7)?.mimeType).toBe('image/png');
    registry.answer(7, '42');
    await answer;

    expect(registry.image(7)).toBeNull();
  });
});

describe('PendingTanRegistry with a decoupled challenge', () => {
  it('resolves undefined after the poll delay so the session asks the bank again', async () => {
    const answer: Promise<string | undefined> = prompt.request(decoupledChallenge);
    let settled = false;
    void answer.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(4999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expect(answer).resolves.toBeUndefined();
    // Still open between two polls, until the session reports the order settled.
    expect(registry.openChallenge(7)?.kind).toBe('decoupled');
    await prompt.settled();
    expect(registry.openChallenge(7)).toBeNull();
  });

  it('polls at once when acknowledged, ignoring any TAN', async () => {
    const answer: Promise<string | undefined> = prompt.request(decoupledChallenge);

    expect(registry.answer(7, 'ignored')).toBe('accepted');

    await expect(answer).resolves.toBeUndefined();
  });

  it('counts the timeout from the first poll of the same order', async () => {
    let polls = 0;
    const poll = async (): Promise<unknown> => {
      try {
        while (true) {
          await prompt.request(decoupledChallenge);
          polls += 1;
        }
      } catch (error: unknown) {
        return error;
      }
    };
    const outcome: Promise<unknown> = poll();

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);

    expect(await outcome).toBeInstanceOf(TanTimeoutError);
    expect(polls).toBe(TIMEOUT_MS / 5000 - 1);
  });

  it('starts a fresh timeout for a new order reference', async () => {
    const first: Promise<string | undefined> = prompt.request(decoupledChallenge);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 5000);
    await first;
    await vi.advanceTimersByTimeAsync(4000);

    const second: Promise<string | undefined> = prompt.request({
      ...decoupledChallenge,
      reference: 'ref-2',
    });
    await vi.advanceTimersByTimeAsync(5000);

    await expect(second).resolves.toBeUndefined();
  });
});

describe('PendingTanRegistry.release', () => {
  it('forgets the challenge and clears its timer', () => {
    void prompt.request(tanChallenge);

    registry.release(7);

    expect(registry.openChallenge(7)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
