import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEMO_DATA_FILE_NAME,
  demoDataFilePath,
  encodeDemoDataset,
  loadDemoDataset,
} from './demo-dataset';
import type { DemoDataset } from './demo-dataset';

const DATASET: DemoDataset = {
  generatedAt: '2026-11-06',
  accounts: [
    {
      id: 1,
      kontonummer: '1234567890',
      unterkonto: null,
      blz: '12030000',
      name: 'Erika Mustermann',
      bezeichnung: 'Girokonto',
      waehrung: 'EUR',
      saldo: 1520.5,
      saldo_datum: '2026-11-06 00:00:00',
      iban: 'DE02120300000000202051',
      bic: 'BYLADEM1001',
      saldo_available: null,
      kategorie: null,
    },
  ],
  categories: [
    {
      id: 7,
      name: 'Lebensmittel',
      nummer: null,
      pattern: 'REWE|EDEKA',
      isregex: 1,
      umsatztyp: 0,
      parent_id: null,
      color: null,
      customcolor: null,
      kommentar: null,
      konto_id: null,
      konto_kategorie: null,
      flags: null,
    },
  ],
  transactions: [
    {
      id: 100,
      konto_id: 1,
      empfaenger_konto: null,
      empfaenger_blz: null,
      empfaenger_name: 'REWE Markt',
      empfaenger_name2: null,
      betrag: -42.17,
      zweck: 'Einkauf',
      zweck2: null,
      zweck3: null,
      datum: '2026-11-06',
      valuta: '2026-11-06',
      saldo: 1520.5,
      art: 'Lastschrift',
      gvcode: '106',
      endtoendid: null,
      kommentar: null,
      purposecode: null,
      customerref: null,
      mandateid: null,
      creditorid: null,
      umsatztyp_id: 7,
      flags: 0,
    },
  ],
  taxTags: [{ category_id: 7, code: 'St-0' }],
};

let dir: string;

function writeFile(content: Buffer): string {
  const path: string = join(dir, DEMO_DATA_FILE_NAME);
  writeFileSync(path, content);
  return path;
}

function writeJson(value: unknown): string {
  return writeFile(gzipSync(Buffer.from(JSON.stringify(value), 'utf8')));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'demo-dataset-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('demo dataset file', () => {
  it('round-trips through encodeDemoDataset and loadDemoDataset', () => {
    const path: string = writeFile(encodeDemoDataset(DATASET));

    expect(loadDemoDataset(path)).toEqual(DATASET);
  });

  it('lives in demo-data next to dist', () => {
    expect(demoDataFilePath()).toBe(join(__dirname, '..', '..', 'demo-data', DEMO_DATA_FILE_NAME));
  });

  it('throws for a file that is not gzipped', () => {
    const path: string = writeFile(Buffer.from(JSON.stringify(DATASET), 'utf8'));

    expect(() => loadDemoDataset(path)).toThrow();
  });

  it('throws for gzipped text that is not JSON', () => {
    const path: string = writeFile(gzipSync(Buffer.from('not json', 'utf8')));

    expect(() => loadDemoDataset(path)).toThrow();
  });

  it('throws for a missing file', () => {
    expect(() => loadDemoDataset(join(dir, 'missing.json.gz'))).toThrow();
  });

  it.each([
    ['an array', []],
    ['null', null],
    ['a missing generatedAt', { ...DATASET, generatedAt: undefined }],
    ['a generatedAt that is no date', { ...DATASET, generatedAt: '6.11.2026' }],
    ['a missing accounts array', { ...DATASET, accounts: undefined }],
    ['categories that are no array', { ...DATASET, categories: {} }],
    ['transactions that are no array', { ...DATASET, transactions: 'none' }],
    ['a missing taxTags array', { ...DATASET, taxTags: undefined }],
  ])('throws for %s', (_label: string, value: unknown) => {
    const path: string = writeJson(value);

    expect(() => loadDemoDataset(path)).toThrow('Demo data');
  });
});
