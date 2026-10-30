import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  applyPurpose,
  checksumSource,
  computeChecksum,
  computeLegacyChecksum,
  getTag,
  javaDoubleToString,
  javaTrim,
  mergeLines,
  parseFixedWidth,
  parseTags,
  purposeToString,
  rewrap,
} from './hibiscus-checksum';
import type { ChecksumFields } from './hibiscus-checksum';

function fields(overrides: Partial<ChecksumFields> = {}): ChecksumFields {
  return {
    kontoId: 5,
    art: 'Lastschrift',
    betrag: -12.5,
    customerref: 'NONREF',
    empfaengerBlz: 'TESTDEFFXXX',
    empfaengerKonto: 'DE00123456780000000000',
    empfaengerName: 'Muster GmbH',
    primanota: null,
    zweck: 'EREF+ABC',
    zweck2: 'KREF+NONREF',
    zweck3: 'SVWZ+Rechnung 42\nDanke\n',
    datum: '2026-07-15',
    valuta: '2026-07-16',
    flags: null,
    ...overrides,
  };
}

describe('javaDoubleToString', () => {
  it.each([
    [-12.5, '-12.5'],
    [100, '100.0'],
    [0, '0.0'],
    [-0, '-0.0'],
    [0.001, '0.001'],
    [0.0001, '1.0E-4'],
    [9999999.99, '9999999.99'],
    [1e7, '1.0E7'],
    [12345678.9, '1.23456789E7'],
    [-25000000, '-2.5E7'],
    [0.1 + 0.2, '0.30000000000000004'],
  ])('formats %s as %s', (value: number, expected: string) => {
    expect(javaDoubleToString(value)).toBe(expected);
  });
});

describe('javaTrim', () => {
  it('strips control chars and spaces but keeps a non-breaking space', () => {
    expect(javaTrim('\t a b \n')).toBe('a b');
    expect(javaTrim(' a ')).toBe(' a ');
  });
});

describe('purpose handling', () => {
  it('merges zweck, zweck2 and the zweck3 lines by spaces, dropping empty lines', () => {
    expect(purposeToString({ zweck: 'a', zweck2: '', zweck3: 'b\n\nc\n' })).toBe('a b c');
    expect(purposeToString({ zweck: null, zweck2: null, zweck3: null })).toBe('');
  });

  it('terminates every merged line with a newline', () => {
    expect(mergeLines(['x', null, '', 'y'])).toBe('x\ny\n');
    expect(mergeLines([null, ''])).toBeNull();
  });

  it('distributes lines into zweck, zweck2 and zweck3 after trimming', () => {
    expect(applyPurpose([' one ', '', 'two', 'three', 'four'])).toEqual({
      zweck: 'one',
      zweck2: 'two',
      zweck3: 'three\nfour\n',
    });
    expect(applyPurpose(['only'])).toEqual({ zweck: 'only', zweck2: null, zweck3: null });
  });

  it('cuts zweck3 at 1000 chars', () => {
    const lines: string[] = ['a', 'b', ...Array.from({ length: 40 }, () => 'x'.repeat(35))];
    expect(applyPurpose(lines).zweck3).toHaveLength(1000);
  });

  it('re-wraps all lines to 35 chars only when one is longer', () => {
    expect(rewrap(35, ['short', 'lines'])).toEqual(['short', 'lines']);
    expect(rewrap(35, ['a'.repeat(40), ' b '])).toEqual(['a'.repeat(35), 'aaaaab']);
  });

  it('cuts an unstructured block into 27-char lines', () => {
    expect(parseFixedWidth('x'.repeat(60))).toEqual(['x'.repeat(27), 'x'.repeat(27), 'xxxxxx']);
    expect(parseFixedWidth('x'.repeat(54))).toEqual(['x'.repeat(27), 'x'.repeat(27)]);
  });
});

describe('SEPA tags', () => {
  it('extracts tags across lines up to the next tag', () => {
    const tags: Map<string, string> = parseTags([
      'EREF+12345 678',
      'MREF+M-1CRED+DE98ZZZ09999999999',
      'SVWZ+Miete Juli',
    ]);
    expect(tags.get('EREF')).toBe('12345 678');
    expect(tags.get('MREF')).toBe('M-1');
    expect(tags.get('CRED')).toBe('DE98ZZZ09999999999');
    expect(tags.get('SVWZ')).toBe('Miete Juli');
  });

  it('takes the text before the first tag as SVWZ', () => {
    expect(parseTags(['Freitext', 'KREF+X']).get('SVWZ')).toBe('Freitext');
  });

  it('falls back to colon tags and removes blanks from IBAN and BIC', () => {
    const tags: Map<string, string> = parseTags(['IBAN: DE12 3456', 'BIC: ABCD EFGH']);
    expect(tags.get('IBAN')).toBe('DE123456');
    expect(tags.get('BIC')).toBe('ABCDEFGH');
  });

  it('returns the whole purpose for a missing or empty SVWZ', () => {
    expect(getTag({ zweck: 'kein tag', zweck2: null, zweck3: null }, 'SVWZ')).toBe('kein tag');
    expect(getTag({ zweck: 'kein tag', zweck2: null, zweck3: null }, 'EREF')).toBeNull();
    expect(getTag({ zweck: 'EREF+1 SVWZ+', zweck2: null, zweck3: null }, 'SVWZ')).toBe(
      'EREF+1 SVWZ+',
    );
    expect(getTag({ zweck: 'EREF+', zweck2: 'KREF+X', zweck3: null }, 'EREF')).toBe('');
  });
});

describe('checksumSource', () => {
  it('concatenates the fields like UmsatzImpl.getChecksum', () => {
    expect(checksumSource(fields())).toBe(
      'LASTSCHRIFT5-12.5NONREFTESTDEFFXXXDE00123456780000000000MUSTER GMBHnull' +
        'EREF+ABC KREF+NONREF SVWZ+RECHNUNG 42 DANKE15.07.202616.07.2026',
    );
  });

  it('renders nulls as Java does, upper-casing only art and name', () => {
    const source: string = checksumSource(
      fields({
        art: null,
        customerref: null,
        empfaengerBlz: null,
        empfaengerKonto: null,
        empfaengerName: null,
        zweck: null,
        zweck2: null,
        zweck3: null,
        betrag: 100,
      }),
    );
    expect(source).toBe('NULL5100.0nullnullnullNULLnull15.07.202616.07.2026');
  });

  it('appends "notbooked" for pending rows only', () => {
    expect(checksumSource(fields({ flags: 2 }))).toMatch(/16\.07\.2026notbooked$/);
    expect(checksumSource(fields({ flags: 1 }))).toMatch(/16\.07\.2026$/);
  });

  it('rejects malformed dates', () => {
    expect(() => checksumSource(fields({ datum: '15.07.2026' }))).toThrow('yyyy-MM-dd');
  });
});

describe('computeChecksum', () => {
  it('is the unsigned CRC32 of the UTF-8 source', () => {
    expect(crc32('123456789')).toBe(0xcbf43926);
    const umlauts: ChecksumFields = fields({ empfaengerName: 'Müller Straße' });
    expect(checksumSource(umlauts)).toContain('MÜLLER STRASSE');
    expect(computeChecksum(umlauts)).toBe(crc32(Buffer.from(checksumSource(umlauts), 'utf8')));
  });

  it('has a windows-1252 legacy variant that only differs for non-ASCII text', () => {
    const ascii: ChecksumFields = fields();
    expect(computeLegacyChecksum(ascii)).toBe(computeChecksum(ascii));
    const umlauts: ChecksumFields = fields({ empfaengerName: 'Müller €' });
    const latin: Buffer = Buffer.from(checksumSource(umlauts).replace('€', '\u0080'), 'latin1');
    expect(computeLegacyChecksum(umlauts)).toBe(crc32(latin));
    expect(computeLegacyChecksum(umlauts)).not.toBe(computeChecksum(umlauts));
  });
});
