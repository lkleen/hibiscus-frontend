import type { TanMethodOption } from '@hibiscus-frontend/shared/contracts/sync';
import {
  EMPTY_DRAFT,
  draftProblems,
  mappingOf,
  mappingRowsOf,
  mediaFor,
  settingsOf,
  withField,
} from './bank-connection-dialog.model';

describe('bank connection draft', () => {
  const valid = {
    ...EMPTY_DRAFT,
    name: 'Comdirect',
    blz: '20041144',
    fintsUrl: 'https://fints.comdirect.de/fints',
    loginName: 'me',
    pin: '1234',
  };

  it('accepts a complete draft', () => {
    expect(draftProblems(valid, true)).toEqual([]);
  });

  it('requires the PIN only for a new connection', () => {
    const noPin = { ...valid, pin: '' };
    expect(draftProblems(noPin, true)).toEqual(['pin']);
    expect(draftProblems(noPin, false)).toEqual([]);
  });

  it('validates BLZ, URL and interval', () => {
    const problems = draftProblems(
      { ...valid, blz: '123', fintsUrl: 'http://x', syncIntervalHours: '200' },
      false,
    );
    expect(problems).toEqual(['blz', 'fintsUrl', 'interval']);
    expect(draftProblems({ ...valid, syncIntervalHours: '1.5' }, false)).toEqual(['interval']);
  });

  it('prefills the URL of a known BLZ only while the URL is empty', () => {
    expect(withField(EMPTY_DRAFT, 'blz', '70120400').fintsUrl).toBe(
      'https://brokerage-hbci.consorsbank.de/hbci',
    );
    expect(withField({ ...EMPTY_DRAFT, fintsUrl: 'https://own' }, 'blz', '20041144').fintsUrl).toBe(
      'https://own',
    );
    expect(withField(EMPTY_DRAFT, 'blz', '12345678').fintsUrl).toBe('');
  });

  it('builds settings with an empty customer ID as null and keeps the TAN choice', () => {
    expect(settingsOf(valid, { tanMethod: 910, tanMedia: null })).toEqual({
      name: 'Comdirect',
      blz: '20041144',
      fintsUrl: 'https://fints.comdirect.de/fints',
      loginName: 'me',
      customerId: null,
      tanMethod: 910,
      tanMedia: null,
      syncIntervalHours: 6,
      enabled: true,
    });
  });
});

describe('account mapping', () => {
  it('prefers the stored mapping, else the matched konto', () => {
    const rows = mappingRowsOf(
      [
        { identifier: 'A', iban: 'A', accountNumber: '1', name: null, kontoId: 5 },
        { identifier: 'B', iban: null, accountNumber: '2', name: 'B', kontoId: 6 },
        { identifier: 'C', iban: null, accountNumber: '3', name: 'C', kontoId: null },
      ],
      [{ accountIdentifier: 'B', kontoId: 9, enabled: false }],
    );
    expect(rows.map((r) => [r.kontoId, r.enabled])).toEqual([
      [5, true],
      [9, false],
      [null, true],
    ]);
    expect(mappingOf(rows)).toEqual([
      { accountIdentifier: 'A', kontoId: 5, enabled: true },
      { accountIdentifier: 'B', kontoId: 9, enabled: false },
    ]);
  });
});

describe('mediaFor', () => {
  const method: TanMethodOption = {
    id: 1,
    name: 'm',
    decoupled: false,
    media: ['One', 'Two'],
    mediaRequired: true,
  };

  it('keeps an offered medium, else the first, and none when not required', () => {
    expect(mediaFor(method, 'Two')).toBe('Two');
    expect(mediaFor(method, 'Gone')).toBe('One');
    expect(mediaFor({ ...method, mediaRequired: false }, 'One')).toBeNull();
    expect(mediaFor(undefined, 'One')).toBeNull();
  });
});
