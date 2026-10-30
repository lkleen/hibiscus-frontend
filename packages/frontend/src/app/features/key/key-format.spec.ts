import { isKeyFormat } from './key-format';

describe('isKeyFormat', () => {
  it('accepts base64 of 32 bytes', () => {
    expect(isKeyFormat('q83vEjRWeJq83vEjRWeJq83vEjRWeJq83vEjRWeJq8s=')).toBe(true);
    expect(isKeyFormat('  q83vEjRWeJq83vEjRWeJq83vEjRWeJq83vEjRWeJq8s=\n')).toBe(true);
  });

  it('rejects other lengths and characters', () => {
    expect(isKeyFormat('')).toBe(false);
    expect(isKeyFormat('abc=')).toBe(false);
    expect(isKeyFormat('q83vEjRWeJq83vEjRWeJq83vEjRWeJq83vEjRWeJq8s')).toBe(false);
    expect(isKeyFormat('q83vEjRWeJq83vEjRWeJq83vEjRWeJq83vEjRWeJq-s=')).toBe(false);
  });
});
