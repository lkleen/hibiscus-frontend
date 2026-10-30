import type { UserKeyStatus } from '@hibiscus-frontend/shared/contracts/user';
import { offersKeepUnlocked, promptNeeded, userKeyBodyOf } from './key-prompt.model';

function status(over: Partial<UserKeyStatus>): UserKeyStatus {
  return { configured: true, mode: 'manual', state: 'not-applicable', ...over };
}

describe('promptNeeded', () => {
  it('asks in manual mode and in memory mode while locked', () => {
    expect(promptNeeded(status({ mode: 'manual' }))).toBe(true);
    expect(promptNeeded(status({ mode: 'memory', state: 'locked' }))).toBe(true);
  });

  it('does not ask when the key is available, unknown or not configured', () => {
    expect(promptNeeded(status({ mode: 'memory', state: 'unlocked' }))).toBe(false);
    expect(promptNeeded(status({ mode: 'stored' }))).toBe(false);
    expect(promptNeeded(status({ configured: false, mode: null }))).toBe(false);
    expect(promptNeeded(null)).toBe(false);
  });
});

describe('offersKeepUnlocked', () => {
  it('is true for memory mode only', () => {
    expect(offersKeepUnlocked(status({ mode: 'memory', state: 'locked' }))).toBe(true);
    expect(offersKeepUnlocked(status({ mode: 'manual' }))).toBe(false);
    expect(offersKeepUnlocked(null)).toBe(false);
  });
});

describe('userKeyBodyOf', () => {
  it('sends keepUnlocked only when offered', () => {
    expect(userKeyBodyOf({ key: 'k', keepUnlocked: true }, true)).toEqual({
      key: 'k',
      keepUnlocked: true,
    });
    expect(userKeyBodyOf({ key: 'k', keepUnlocked: true }, false)).toEqual({ key: 'k' });
  });
});
