import { accountLabel } from './account-label';

describe('accountLabel', () => {
  it('prefers the account label', () => {
    expect(accountLabel({ bezeichnung: 'Checking', name: 'Jane Doe' })).toBe('Checking');
  });

  it('falls back to the holder when the account has no label', () => {
    expect(accountLabel({ bezeichnung: null, name: 'Jane Doe' })).toBe('Jane Doe');
  });
});
