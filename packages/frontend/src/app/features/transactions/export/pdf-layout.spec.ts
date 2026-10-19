import type { ExportColumn, ExportDocument, PdfPageSetup, PdfPaperFormat } from './export.model';
import { pageSizeMm, PDF_BASE_FONT_PT, PDF_FLOOR_FONT_PT, planPdfLayout } from './pdf-layout';
import type { PdfLayout } from './pdf-layout';

const measure = (text: string, fontSizePt: number, bold: boolean): number =>
  text.length * fontSizePt * 0.2 * (bold ? 1.1 : 1);

function longDoc(): ExportDocument {
  const columns: ExportColumn[] = [
    { id: 'date', header: 'Date', kind: 'text' },
    ...Array.from({ length: 8 }, (_: unknown, i: number): ExportColumn => ({
      id: `t${i}`,
      header: `Text column ${i}`,
      kind: 'text',
    })),
    { id: 'amount', header: 'Amount', kind: 'amount' },
  ];
  return {
    title: 'T',
    scope: { period: 'p', accounts: 'a', search: null },
    columns,
    rows: [
      {
        kind: 'transaction',
        level: 1,
        cells: [
          '2026-01-02',
          ...Array.from({ length: 8 }, (): string => 'a very long purpose text '.repeat(4)),
          -1234.5,
        ],
      },
    ],
  };
}

const FORMATS: PdfPaperFormat[] = ['a4', 'a3', 'a5', 'letter', 'legal'];

describe('pageSizeMm', () => {
  it('swaps width and height for landscape', () => {
    expect(pageSizeMm({ format: 'a4', orientation: 'portrait', fit: 'wrap' })).toEqual({
      widthMm: 210,
      heightMm: 297,
    });
    expect(pageSizeMm({ format: 'a4', orientation: 'landscape', fit: 'wrap' })).toEqual({
      widthMm: 297,
      heightMm: 210,
    });
  });
});

describe('planPdfLayout invariant', () => {
  for (const format of FORMATS) {
    for (const orientation of ['portrait', 'landscape'] as const) {
      for (const fit of ['shrink', 'wrap', 'split'] as const) {
        it(`fits ${format} ${orientation} ${fit}`, () => {
          const page: PdfPageSetup = { format, orientation, fit };
          const layout: PdfLayout = planPdfLayout({ doc: longDoc(), page, locale: 'en', measure });
          const printable: number = layout.pageWidthMm - 2 * layout.marginMm;
          const total = (cols: readonly number[]): number =>
            cols.reduce((s: number, c: number): number => s + layout.columnWidthsMm[c], 0);
          for (const columns of layout.splitPages) {
            expect(total(columns)).toBeLessThanOrEqual(printable + 1e-6);
            expect(columns[0]).toBe(0);
          }
          expect(layout.fontSizePt).toBeGreaterThanOrEqual(PDF_FLOOR_FONT_PT);
          expect(layout.fontSizePt).toBeLessThanOrEqual(PDF_BASE_FONT_PT);
          const covered = new Set<number>(layout.splitPages.flat());
          expect(covered.size).toBe(10);
        });
      }
    }
  }
});

describe('planPdfLayout fit modes', () => {
  const page = (fit: PdfPageSetup['fit']): PdfPageSetup => ({
    format: 'a4',
    orientation: 'portrait',
    fit,
  });

  it('keeps the base font and natural widths when everything fits', () => {
    const doc: ExportDocument = {
      ...longDoc(),
      columns: [{ id: 'a', header: 'A', kind: 'text' }],
      rows: [{ kind: 'transaction', level: 0, cells: ['x'] }],
    };
    const layout: PdfLayout = planPdfLayout({ doc, page: page('shrink'), locale: 'en', measure });
    expect(layout.fontSizePt).toBe(PDF_BASE_FONT_PT);
    expect(layout.wrapColumns).toEqual([false]);
    expect(layout.splitPages).toEqual([[0]]);
  });

  it('shrinks the font before wrapping', () => {
    const doc: ExportDocument = {
      ...longDoc(),
      columns: longDoc().columns.slice(0, 4),
      rows: [
        {
          kind: 'transaction',
          level: 0,
          cells: ['2026-01-01', 'x'.repeat(40), 'y'.repeat(40), 'z'.repeat(40)],
        },
      ],
    };
    const layout: PdfLayout = planPdfLayout({ doc, page: page('shrink'), locale: 'en', measure });
    expect(layout.fontSizePt).toBeLessThan(PDF_BASE_FONT_PT);
    expect(layout.hitsFloor).toBe(false);
    expect(layout.wrapColumns.every((w: boolean): boolean => !w)).toBe(true);
  });

  it('hits the floor, wraps text columns and keeps amount and date columns natural', () => {
    const layout: PdfLayout = planPdfLayout({
      doc: longDoc(),
      page: page('shrink'),
      locale: 'en',
      measure,
    });
    expect(layout.hitsFloor).toBe(true);
    expect(layout.fontSizePt).toBe(PDF_FLOOR_FONT_PT);
    expect(layout.wrapColumns[0]).toBe(false);
    expect(layout.wrapColumns[9]).toBe(false);
    expect(layout.wrapColumns[1]).toBe(true);
  });

  it('wraps at the base font', () => {
    const layout: PdfLayout = planPdfLayout({
      doc: longDoc(),
      page: page('wrap'),
      locale: 'en',
      measure,
    });
    expect(layout.fontSizePt).toBe(PDF_BASE_FONT_PT);
    expect(layout.hitsFloor).toBe(false);
    expect(layout.wrapColumns[1]).toBe(true);
  });

  it('splits into several pages repeating the first column without wrapping', () => {
    const layout: PdfLayout = planPdfLayout({
      doc: longDoc(),
      page: page('split'),
      locale: 'de',
      measure,
    });
    expect(layout.splitPages.length).toBeGreaterThan(1);
    expect(layout.fontSizePt).toBe(PDF_BASE_FONT_PT);
    for (const columns of layout.splitPages) expect(columns[0]).toBe(0);
  });

  it('caps a single too-wide column and wraps only it', () => {
    const doc: ExportDocument = {
      ...longDoc(),
      columns: [
        { id: 'a', header: 'A', kind: 'text' },
        { id: 'b', header: 'B', kind: 'text' },
      ],
      rows: [{ kind: 'transaction', level: 0, cells: ['a', 'b'.repeat(500)] }],
    };
    const layout: PdfLayout = planPdfLayout({ doc, page: page('split'), locale: 'en', measure });
    expect(layout.wrapColumns).toEqual([false, true]);
    expect(layout.columnWidthsMm[0] + layout.columnWidthsMm[1]).toBeLessThanOrEqual(186 + 1e-6);
  });

  it('throws without columns', () => {
    expect(() =>
      planPdfLayout({
        doc: { ...longDoc(), columns: [] },
        page: page('wrap'),
        locale: 'en',
        measure,
      }),
    ).toThrow();
  });
});

function realisticDoc(): ExportDocument {
  const text = (id: string, header: string): ExportColumn => ({ id, header, kind: 'text' });
  const amount = (id: string, header: string): ExportColumn => ({ id, header, kind: 'amount' });
  const purpose: string = Array.from({ length: 50 }, (_: unknown, i: number): string => `wort${i}`)
    .join(' ')
    .slice(0, 300);
  return {
    title: 'T',
    scope: { period: 'p', accounts: 'a', search: null },
    columns: [
      text('date', 'Valuta'),
      text('account', 'Konto'),
      text('name', 'Name'),
      text('zweck1', 'Verwendungszweck 1'),
      text('zweck2', 'Verwendungszweck 2'),
      text('art', 'Art'),
      text('gv', 'GV-Code'),
      text('cat', 'Kategorie'),
      text('mandate', 'Mandatsreferenz'),
      text('iban', 'Gegenkonto'),
      amount('betrag', 'Betrag'),
      amount('saldo', 'Saldo'),
    ],
    rows: [
      {
        kind: 'transaction',
        level: 0,
        cells: [
          '2026-03-04',
          'Girokonto',
          'Max Mustermann',
          purpose,
          'KREF+NONREF',
          'Lastschrift',
          '105',
          'Lebensmittel',
          'MNDT-000123',
          'DE89370400440532013000',
          -12.5,
          1234.56,
        ],
      },
    ],
  };
}

describe('planPdfLayout with a realistic 12-column document', () => {
  const page = (fit: PdfPageSetup['fit']): PdfPageSetup => ({
    format: 'a4',
    orientation: 'landscape',
    fit,
  });
  const plan = (fit: PdfPageSetup['fit']): PdfLayout =>
    planPdfLayout({ doc: realisticDoc(), page: page(fit), locale: 'de', measure });

  it('keeps every text column at least as wide as its capped longest word at the floor', () => {
    const layout: PdfLayout = plan('shrink');
    expect(layout.fontSizePt).toBeGreaterThanOrEqual(PDF_FLOOR_FONT_PT);
    const doc: ExportDocument = realisticDoc();
    doc.columns.forEach((column: ExportColumn, i: number): void => {
      if (column.kind === 'amount') return;
      const words: string[] = [column.header, String(doc.rows[0].cells[i])].flatMap(
        (text: string): string[] => text.split(/\s+/),
      );
      const longest: number = Math.max(
        ...words.map((word: string): number => measure(word, layout.fontSizePt, true)),
      );
      expect(layout.columnWidthsMm[i]).toBeGreaterThanOrEqual(Math.min(longest, 25) - 1e-6);
    });
  });

  it('gives short columns their natural width when wrapping', () => {
    const layout: PdfLayout = plan('wrap');
    const natural: number = measure('Girokonto', PDF_BASE_FONT_PT, false) + 2;
    expect(layout.columnWidthsMm[1]).toBeGreaterThanOrEqual(natural - 1e-6);
    expect(layout.wrapColumns[1]).toBe(false);
    expect(layout.wrapColumns[3]).toBe(true);
    expect(layout.columnWidthsMm[3]).toBeLessThanOrEqual(0.35 * 273 + 1e-6);
  });

  it('puts several data columns on the first split page', () => {
    const layout: PdfLayout = plan('split');
    expect(layout.splitPages[0].length).toBeGreaterThan(2);
    expect(layout.splitPages.length).toBeLessThan(6);
  });
});

describe('planPdfLayout bold measuring', () => {
  it('sizes an amount column by its bold header when that is wider than the values', () => {
    const doc: ExportDocument = {
      title: 'T',
      scope: { period: 'p', accounts: 'a', search: null },
      columns: [
        { id: 'name', header: 'Name', kind: 'text' },
        { id: 'in', header: 'Einnahmen', kind: 'amount' },
      ],
      rows: [{ kind: 'transaction', level: 0, cells: ['x', 1.5] }],
    };
    const layout: PdfLayout = planPdfLayout({
      doc,
      page: { format: 'a4', orientation: 'portrait', fit: 'wrap' },
      locale: 'en',
      measure,
    });
    expect(layout.columnWidthsMm[1]).toBeCloseTo(measure('Einnahmen', PDF_BASE_FONT_PT, true) + 2);
    expect(layout.columnWidthsMm[1]).toBeGreaterThan(
      measure('Einnahmen', PDF_BASE_FONT_PT, false) + 2,
    );
  });

  it('measures category and total rows bold', () => {
    const doc: ExportDocument = {
      title: 'T',
      scope: { period: 'p', accounts: 'a', search: null },
      columns: [{ id: 'name', header: 'N', kind: 'text' }],
      rows: [{ kind: 'category', level: 0, cells: ['abcdefghij'] }],
    };
    const layout: PdfLayout = planPdfLayout({
      doc,
      page: { format: 'a4', orientation: 'portrait', fit: 'wrap' },
      locale: 'en',
      measure,
    });
    expect(layout.columnWidthsMm[0]).toBeCloseTo(measure('abcdefghij', PDF_BASE_FONT_PT, true) + 2);
  });
});
