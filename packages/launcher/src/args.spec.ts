import { describe, expect, it } from 'vitest';
import { defaultAppDir, parseArgs } from './args';

describe('parseArgs', () => {
  it('uses defaults', () => {
    expect(parseArgs([], '/app')).toEqual({
      mode: undefined,
      port: 8080,
      appDir: '/app',
      open: true,
      help: false,
    });
  });

  it('parses all flags', () => {
    expect(
      parseArgs(['--mariadb', '--port', '9000', '--app-dir', '/x', '--no-open'], '/app'),
    ).toEqual({
      mode: 'mariadb',
      port: 9000,
      appDir: '/x',
      open: false,
      help: false,
    });
    expect(parseArgs(['--demo', '--help'], '/app')).toMatchObject({ mode: 'demo', help: true });
  });

  it('rejects bad input', () => {
    expect(() => parseArgs(['--demo', '--mariadb'], '/app')).toThrow(/mutually exclusive/);
    expect(() => parseArgs(['--port'], '/app')).toThrow(/needs a value/);
    expect(() => parseArgs(['--port', 'abc'], '/app')).toThrow(/integer/);
    expect(() => parseArgs(['--port', '70000'], '/app')).toThrow(/between/);
    expect(() => parseArgs(['--nope'], '/app')).toThrow(/Unknown argument/);
  });

  it('derives the release app dir', () => {
    expect(defaultAppDir('/r/app/launcher/dist')).toBe('/r/app');
  });
});
