import { describe, expect, it } from 'vitest';
import {
  beginReconfiguring,
  endReconfiguring,
  isReconfiguring,
  isUserBusy,
  markUserBusy,
  unmarkUserBusy,
  UserBusyError,
  whileReconfiguring,
  whileUserBusy,
} from './user-activity';

describe('busy registry', () => {
  it('counts the runs of a user', () => {
    markUserBusy('alice');
    markUserBusy('alice');
    unmarkUserBusy('alice');
    expect(isUserBusy('alice')).toBe(true);
    expect(isUserBusy('bob')).toBe(false);
    unmarkUserBusy('alice');
    expect(isUserBusy('alice')).toBe(false);
  });

  it('throws on an unbalanced unmark or end', () => {
    expect(() => unmarkUserBusy('bob')).toThrow('not marked busy');
    expect(() => endReconfiguring('bob')).toThrow('not reconfiguring');
  });
});

describe('reconfiguring and busy exclude each other', () => {
  it('refuses a run while the user is reconfiguring, and only that user', () => {
    beginReconfiguring('alice');

    expect(() => markUserBusy('alice')).toThrow(UserBusyError);
    expect(isUserBusy('alice')).toBe(false);
    markUserBusy('bob');
    unmarkUserBusy('bob');
    endReconfiguring('alice');
    markUserBusy('alice');
    unmarkUserBusy('alice');
  });

  it('refuses reconfiguring while a run is in progress, and a second reconfiguration', () => {
    markUserBusy('alice');
    expect(() => beginReconfiguring('alice')).toThrow(UserBusyError);
    expect(isReconfiguring('alice')).toBe(false);
    unmarkUserBusy('alice');

    beginReconfiguring('alice');
    expect(() => beginReconfiguring('alice')).toThrow(UserBusyError);
    endReconfiguring('alice');
  });

  it('clears the marks when the work fails', async () => {
    await expect(
      whileUserBusy('alice', async () => {
        throw new Error('run failed');
      }),
    ).rejects.toThrow('run failed');
    await expect(
      whileReconfiguring('alice', async () => {
        expect(() => markUserBusy('alice')).toThrow(UserBusyError);
        throw new Error('save failed');
      }),
    ).rejects.toThrow('save failed');

    expect(isUserBusy('alice')).toBe(false);
    expect(isReconfiguring('alice')).toBe(false);
  });
});
