import { beforeAll, describe, expect, it } from 'vitest';
import type { BankingInformation, Statement } from 'lib-fints' with { 'resolution-mode': 'import' };
import type { FetchedBooking } from './fetched-booking';
import {
  assertStatementsParsed,
  capturedRawInfo,
  describeBankingInformation,
  installMt940Hooks,
  parseInfo86,
  toFetchedBookings,
} from './fints-session';
import type { FintsDiscovery } from './fints-session';

type LibFints = typeof import('lib-fints', { with: { 'resolution-mode': 'import' } });

let lib: LibFints;

beforeAll(async () => {
  lib = await import('lib-fints');
  installMt940Hooks(lib.Mt940Parser);
  // Installing twice must not wrap twice.
  installMt940Hooks(lib.Mt940Parser);
});

const MT940: string = [
  ':20:STARTUMSE',
  ':25:12345678/0123456789',
  ':28C:00000/001',
  ':60F:C261020EUR1000,00',
  ':61:2610211021DR12,34NDDTNONREF//BANKREF',
  ':86:105?00SEPA-BASISLASTSCHRIFT?109310?20EREF+ABC123?21MREF+M-1?22CRED+DE98ZZZ',
  '?23SVWZ+Strom Oktober?24KREF+K-9?30COBADEFFXXX?31DE89370400440532013000',
  '?32Stadtwerke Muster?33GmbH?34992',
  ':61:2610221022CR100,00NTRFNONREF',
  ':86:999Freitext ohne Struktur',
  ':62F:C261022EUR1087,66',
  '-',
  '',
].join('\r\n');

function parse(input: string): Statement[] {
  return new lib.Mt940Parser(input).parse();
}

describe('parseInfo86', () => {
  it('splits the sub-fields, keeping every purpose line raw', () => {
    expect(parseInfo86('166?00GUTSCHRIFT?20Zeile 1?21?22Zeile 3?60Zeile 4?32Name?34000')).toEqual({
      gvCode: '166',
      bookingText: 'GUTSCHRIFT',
      primanota: null,
      counterpartyBlz: null,
      counterpartyAccount: null,
      counterpartyName: 'Name',
      counterpartyName2: null,
      addKey: '000',
      purposeLines: ['Zeile 1', 'Zeile 3', 'Zeile 4'],
    });
  });

  it('treats GV code 999 as one unstructured purpose block', () => {
    expect(parseInfo86('999Freier ?Text').purposeLines).toEqual(['Freier ?Text']);
  });

  it('reads another separator than ?', () => {
    expect(parseInfo86('116@00UEBERWEISUNG@20Text').purposeLines).toEqual(['Text']);
  });
});

describe('toFetchedBookings with lib-fints MT940 parsing', () => {
  it('maps the raw :86: and :61: data as hbci4java reads it, with running balances', () => {
    const bookings: FetchedBooking[] = toFetchedBookings(parse(MT940), capturedRawInfo);

    expect(bookings).toEqual([
      {
        bookingDate: '2026-10-21',
        valueDate: '2026-10-21',
        amount: -12.34,
        balanceAfter: 987.66,
        bookingText: 'SEPA-BASISLASTSCHRIFT',
        primanota: '9310',
        // lib-fints would have replaced it with the KREF+ value.
        customerRef: 'NONREF',
        gvCode: '105',
        addKey: '992',
        counterpartyAccount: 'DE89370400440532013000',
        counterpartyBlz: 'COBADEFFXXX',
        counterpartyName: 'Stadtwerke Muster',
        counterpartyName2: 'GmbH',
        purposeLines: ['EREF+ABC123', 'MREF+M-1', 'CRED+DE98ZZZ', 'SVWZ+Strom Oktober', 'KREF+K-9'],
        pending: false,
      },
      {
        bookingDate: '2026-10-22',
        valueDate: '2026-10-22',
        amount: 100,
        balanceAfter: 1087.66,
        bookingText: null,
        primanota: null,
        customerRef: 'NONREF',
        gvCode: '999',
        addKey: null,
        counterpartyAccount: null,
        counterpartyBlz: null,
        counterpartyName: null,
        counterpartyName2: null,
        purposeLines: ['Freitext ohne Struktur'],
        pending: false,
      },
    ]);
  });

  it('derives the start from the closing balance when the opening balance is missing', () => {
    const statements: Statement[] = parse(MT940.replace(':60F:C261020EUR1000,00\r\n', ''));

    const bookings: FetchedBooking[] = toFetchedBookings(statements, capturedRawInfo);

    expect(bookings.map((booking: FetchedBooking) => booking.balanceAfter)).toEqual([
      987.66, 1087.66,
    ]);
  });

  it('throws for a statement without any balance', () => {
    const statements: Statement[] = parse(
      MT940.replace(':60F:C261020EUR1000,00\r\n', '').replace(':62F:C261022EUR1087,66\r\n', ''),
    );

    expect(() => toFetchedBookings(statements, capturedRawInfo)).toThrow('neither');
  });
});

describe('assertStatementsParsed', () => {
  it('passes parsed statements', () => {
    expect(() => assertStatementsParsed(parse(MT940))).not.toThrow();
  });

  it('throws when lib-fints could not parse the MT940 data', () => {
    expect(() => assertStatementsParsed(parse(':20:X\r\n:60F:garbage\r\n'))).toThrow(
      'could not be parsed',
    );
  });
});

describe('describeBankingInformation', () => {
  const info = {
    systemId: 'sys',
    bankMessages: [],
    bpd: {
      availableTanMethodIds: [900, 902],
      supportedTanMethods: [
        {
          id: 900,
          name: 'iTAN',
          isDecoupled: false,
          activeTanMedia: [],
          tanMediaRequirement: 0,
        },
        {
          id: 902,
          name: 'pushTAN 2.0',
          isDecoupled: true,
          activeTanMedia: ['Handy'],
          tanMediaRequirement: 2,
        },
        { id: 999, name: 'unavailable', isDecoupled: false, activeTanMedia: [] },
      ],
    },
    upd: {
      bankAccounts: [
        { accountNumber: '0123', iban: 'DE02120300000000202051', product: 'Girokonto' },
        { accountNumber: '0456', holder1: 'Max Muster' },
      ],
    },
  } as unknown as BankingInformation;

  it('lists the available TAN methods and the accounts', () => {
    const discovery: FintsDiscovery = describeBankingInformation(info, 902);

    expect(discovery).toEqual({
      tanMethods: [
        { id: 900, name: 'iTAN', decoupled: false, media: [], mediaRequired: false },
        { id: 902, name: 'pushTAN 2.0', decoupled: true, media: ['Handy'], mediaRequired: true },
      ],
      selectedTanMethod: 902,
      tanMedia: ['Handy'],
      accounts: [
        {
          identifier: 'DE02120300000000202051',
          iban: 'DE02120300000000202051',
          accountNumber: '0123',
          name: 'Girokonto',
        },
        { identifier: '0456', iban: null, accountNumber: '0456', name: 'Max Muster' },
      ],
    });
  });

  it('falls back to the first method when the stored one is no longer offered', () => {
    expect(describeBankingInformation(info, 999).selectedTanMethod).toBe(900);
  });

  it('throws without an account list', () => {
    expect(() => describeBankingInformation({ ...info, upd: undefined }, null)).toThrow(
      'no account list',
    );
  });
});
