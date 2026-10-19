import type { ExportDocument, ExportRow } from './export.model';
import { toCsv, toJson, toPdf, type PdfResult } from './export-writers';

const autoTable = vi.hoisted(() => vi.fn());
const pdfMock = vi.hoisted(() => ({
  text: vi.fn(),
  addPage: vi.fn(),
  setPage: vi.fn(),
  setFont: vi.fn(),
  setFontSize: vi.fn(),
  setProperties: vi.fn(),
  getTextWidth: vi.fn((text: string): number => text.length * 1.5),
  getNumberOfPages: vi.fn((): number => 2),
  output: vi.fn((): Blob => new Blob(['pdf'], { type: 'application/pdf' })),
}));
const ctor = vi.hoisted(() => vi.fn());

vi.mock('jspdf', () => ({
  jsPDF: function (options: unknown): unknown {
    ctor(options);
    return pdfMock;
  },
}));
vi.mock('jspdf-autotable', () => ({ default: autoTable }));

function row(kind: ExportRow['kind'], level: number, cells: ExportRow['cells']): ExportRow {
  return { kind, level, cells };
}

function doc(rows: ExportRow[]): ExportDocument {
  return {
    title: 'Title',
    scope: { period: '2026', accounts: 'All', search: 'rent' },
    columns: [
      { id: 'name', header: 'Name', kind: 'text' },
      { id: 'amount', header: 'Amount', kind: 'amount' },
    ],
    rows,
  };
}

async function text(blob: Blob): Promise<string> {
  return await blob.text();
}

describe('toCsv', () => {
  const rows: ExportRow[] = [
    row('category', 0, ['Food, "bio"', 1234.5]),
    row('transaction', 1, ['line\nbreak', -2]),
    row('total', 0, ['Total', null]),
  ];

  it('writes en with comma, dot, BOM and RFC 4180 quoting', async () => {
    const blob: Blob = toCsv(doc(rows), { locale: 'en', levelHeader: 'level' });
    expect(blob.type).toBe('text/csv;charset=utf-8');
    expect(await text(blob)).toBe(
      '﻿level,Name,Amount\r\n0,"Food, ""bio""",1234.50\r\n1,"  line\nbreak",-2.00\r\n0,Total,\r\n',
    );
  });

  it('writes de with semicolon and decimal comma', async () => {
    const out: string = await text(toCsv(doc(rows), { locale: 'de', levelHeader: 'Ebene' }));
    expect(out).toBe(
      '﻿Ebene;Name;Amount\r\n0;"Food, ""bio""";1234,50\r\n1;"  line\nbreak";-2,00\r\n0;Total;\r\n',
    );
  });

  it('quotes fields containing the separator only for that locale', async () => {
    const out: string = await text(
      toCsv(doc([row('total', 0, ['a;b', 1])]), { locale: 'de', levelHeader: 'l' }),
    );
    expect(out).toContain('0;"a;b";1,00');
  });
});

describe('toJson', () => {
  it('nests rows by level', async () => {
    const blob: Blob = toJson(
      doc([
        row('category', 0, ['A', 3]),
        row('category', 1, ['B', 2]),
        row('transaction', 2, ['t', 1]),
        row('transaction', 1, ['u', null]),
        row('total', 0, ['T', 3]),
      ]),
      new Date('2026-10-19T10:00:00Z'),
    );
    expect(blob.type).toBe('application/json');
    const parsed = JSON.parse(await text(blob));
    expect(parsed.exportedAt).toBe('2026-10-19T10:00:00.000Z');
    expect(parsed.title).toBe('Title');
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].cells).toEqual({ name: 'A', amount: 3 });
    expect(parsed.rows[0].children).toHaveLength(2);
    expect(parsed.rows[0].children[0].children[0].cells.name).toBe('t');
    expect(parsed.rows[1].children).toBeUndefined();
  });

  it('throws when a level jumps by more than one', () => {
    expect(() =>
      toJson(doc([row('category', 0, ['A', 1]), row('transaction', 2, ['t', 1])]), new Date()),
    ).toThrow();
    expect(() => toJson(doc([row('transaction', 1, ['t', 1])]), new Date())).toThrow();
  });
});

describe('toPdf', () => {
  beforeEach(() => {
    autoTable.mockClear();
    pdfMock.text.mockClear();
  });

  it('builds the table through autoTable and adds the page footer', async () => {
    const { blob, layout }: PdfResult = await toPdf(
      doc([
        row('category', 0, ['Food', 1234.5]),
        row('transaction', 1, ['Shop', -2]),
        row('total', 0, ['Total', null]),
      ]),
      {
        locale: 'de',
        page: { format: 'a4', orientation: 'landscape', fit: 'wrap' },
        labels: { page: (c: number, t: number): string => `Seite ${c} / ${t}` },
      },
    );
    expect(blob.type).toBe('application/pdf');
    expect(layout.pageWidthMm).toBe(297);
    expect(ctor).toHaveBeenCalledWith({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    expect(autoTable).toHaveBeenCalledTimes(1);
    const options = autoTable.mock.calls[0][1];
    expect(options.head).toEqual([['Name', 'Amount']]);
    expect(options.showHead).toBe('everyPage');
    expect(options.headStyles.overflow).toBe('linebreak');
    expect(pdfMock.setProperties).toHaveBeenCalledWith({ title: 'Title' });
    expect(options.body.map((r: { content: string }[]) => r.map((c) => c.content))).toEqual([
      ['Food', '1.234,50'],
      ['  Shop', '-2,00'],
      ['Total', ''],
    ]);
    expect(
      options.body.map((r: { styles: { fontStyle: string } }[]) => r[0].styles.fontStyle),
    ).toEqual(['bold', 'normal', 'bold']);
    expect(options.columnStyles[1].halign).toBe('right');
    expect(options.columnStyles[1].overflow).toBe('visible');
    const texts: string[] = pdfMock.text.mock.calls.map((c: unknown[]): string => String(c[0]));
    expect(texts).toEqual(
      expect.arrayContaining(['Title', '2026', 'All', 'rent', 'Seite 1 / 2', 'Seite 2 / 2']),
    );
  });

  it('draws one table per split page', async () => {
    const wide: ExportDocument = {
      ...doc([]),
      columns: Array.from({ length: 8 }, (_: unknown, i: number) => ({
        id: `c${i}`,
        header: `Header ${i}`,
        kind: 'text' as const,
      })),
      rows: [
        row(
          'transaction',
          0,
          Array.from({ length: 8 }, (): string => 'y'.repeat(30)),
        ),
      ],
    };
    await toPdf(wide, {
      locale: 'en',
      page: { format: 'a5', orientation: 'portrait', fit: 'split' },
      labels: { page: (c: number, t: number): string => `${c}/${t}` },
    });
    expect(autoTable.mock.calls.length).toBeGreaterThan(1);
    expect(pdfMock.addPage).toHaveBeenCalled();
    for (const call of autoTable.mock.calls) expect(call[1].head[0][0]).toBe('Header 0');
  });
});
