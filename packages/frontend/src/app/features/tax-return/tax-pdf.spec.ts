import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import { TAX_SECTIONS, type TaxSection } from '../../core/tax/tax-sections';
import { taxPdfFileName, toTaxPdf, type TaxPdfLabels } from './tax-pdf';
import type { TaxReport } from './tax-report';

const autoTable = vi.hoisted(() => vi.fn());
const pdfMock = vi.hoisted(() => ({
  internal: { pageSize: { getWidth: (): number => 210, getHeight: (): number => 297 } },
  lastAutoTable: { finalY: 100 },
  text: vi.fn(),
  addPage: vi.fn(),
  setPage: vi.fn(),
  setFont: vi.fn(),
  setFontSize: vi.fn(),
  setProperties: vi.fn(),
  splitTextToSize: vi.fn((text: string): string[] => [text]),
  getNumberOfPages: vi.fn((): number => 3),
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

const category: CategoryRow = {
  id: 7,
  name: 'Haftpflicht',
  parent_id: null,
} as CategoryRow;

function tx(id: number, betrag: number, zweck: string | null): TransactionRow {
  return {
    id,
    datum: '2025-03-04',
    betrag,
    empfaenger_name: id === 1 ? 'Allianz' : null,
    empfaenger_konto: id === 1 ? 'DE02120300000000202051' : null,
    zweck,
    zweck2: 'ignored',
    zweck3: 'ignored',
  } as TransactionRow;
}

const [wk, va]: TaxSection[] = [TAX_SECTIONS[0], TAX_SECTIONS[1]];

const report: TaxReport = {
  year: 2025,
  sections: [
    {
      section: wk,
      categories: [{ category, path: 'Beruf / Haftpflicht', income: 0, expenses: 10, count: 1 }],
      income: 0,
      expenses: 10,
      count: 1,
      receipts: [{ no: 1, transaction: tx(2, -10, null), category }],
    },
    {
      section: va,
      categories: [{ category, path: 'Haftpflicht', income: 5, expenses: 1234.5, count: 2 }],
      income: 5,
      expenses: 1234.5,
      count: 2,
      receipts: [
        { no: 2, transaction: tx(1, -1234.5, 'Beitrag'), category },
        { no: 3, transaction: tx(3, 5, 'Erstattung'), category },
      ],
    },
  ],
  unassigned: { transactions: [], sum: 0 },
  mixed: [],
};

const labels: TaxPdfLabels = {
  title: 'Tax return 2025',
  scope: 'All accounts',
  generatedOn: 'Created 2026-01-02',
  disclaimer: 'No tax advice',
  summary: 'Summary',
  total: 'Total',
  columns: {
    no: 'No.',
    date: 'Date',
    payee: 'Payee',
    iban: 'IBAN',
    purpose: 'Purpose',
    category: 'Category',
    amount: 'Amount',
    income: 'Income',
    expenses: 'Expenses',
    count: 'Count',
  },
  section: (s: TaxSection) => ({
    name: `Name ${s.code}`,
    form: `Form ${s.code}`,
    note: `Note ${s.code}`,
  }),
  page: (c: number, t: number): string => `Page ${c} / ${t}`,
};

function texts(): string[] {
  return pdfMock.text.mock.calls.map((c: unknown[]): string => String(c[0]));
}

function contents(row: { content: string }[]): string[] {
  return row.map((c) => c.content);
}

describe('toTaxPdf', () => {
  beforeEach(() => {
    autoTable.mockClear();
    pdfMock.text.mockClear();
    pdfMock.addPage.mockClear();
    pdfMock.setPage.mockClear();
  });

  it('builds the summary rows with indented categories and a grand total', async () => {
    const blob: Blob = await toTaxPdf({ report, labels, locale: 'en' });
    expect(blob.type).toBe('application/pdf');
    expect(ctor).toHaveBeenCalledWith({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const summary = autoTable.mock.calls[0][1];
    expect(summary.body.map(contents)).toEqual([
      ['Form St-WK – Name St-WK', '0.00', '10.00', '1'],
      ['    Beruf / Haftpflicht', '0.00', '10.00', '1'],
      ['Form St-VA – Name St-VA', '5.00', '1,234.50', '2'],
      ['    Haftpflicht', '5.00', '1,234.50', '2'],
      ['Total', '5.00', '1,244.50', '3'],
    ]);
    expect(texts()).toEqual(
      expect.arrayContaining(['Tax return 2025', 'All accounts', 'No tax advice']),
    );
  });

  it('starts a new page and a receipt table per section', async () => {
    await toTaxPdf({ report, labels, locale: 'en' });
    expect(autoTable).toHaveBeenCalledTimes(3);
    expect(pdfMock.addPage).toHaveBeenCalledTimes(2);
    expect(texts()).toEqual(
      expect.arrayContaining(['Form St-WK – Name St-WK', 'Note St-WK', 'Note St-VA']),
    );
    const second = autoTable.mock.calls[2][1];
    expect(second.head[0]).toEqual([
      'No.',
      'Date',
      'Payee',
      'IBAN',
      'Purpose',
      'Category',
      'Amount',
    ]);
    expect(second.body).toEqual([
      [
        '2',
        '2025-03-04',
        'Allianz',
        'DE02120300000000202051',
        'Beitrag',
        'Haftpflicht',
        '1,234.50',
      ],
      ['3', '2025-03-04', '-', '-', 'Erstattung', 'Haftpflicht', '5.00'],
    ]);
    const widths: number = Object.values<{ cellWidth: number }>(second.columnStyles).reduce(
      (sum: number, c: { cellWidth: number }) => sum + c.cellWidth,
      0,
    );
    expect(widths).toBe(180);
  });

  it('shows amounts positive, a dash for null values and the raw purpose only', async () => {
    await toTaxPdf({ report, labels, locale: 'en' });
    const first = autoTable.mock.calls[1][1];
    expect(first.body[0]).toEqual([
      '1',
      '2025-03-04',
      '-',
      '-',
      '-',
      'Beruf / Haftpflicht',
      '10.00',
    ]);
  });

  it('formats numbers and dates per locale', async () => {
    await toTaxPdf({ report, labels, locale: 'de' });
    const second = autoTable.mock.calls[2][1];
    expect(second.body[0][1]).toBe('04.03.2025');
    expect(second.body[0][6]).toBe('1.234,50');
    expect(
      autoTable.mock.calls[0][1].body.at(-1).map((c: { content: string }) => c.content),
    ).toEqual(['Total', '5,00', '1.244,50', '3']);
  });

  it('writes the title and the page label into every footer', async () => {
    await toTaxPdf({ report, labels, locale: 'en' });
    expect(pdfMock.setPage).toHaveBeenCalledTimes(3);
    expect(texts()).toEqual(expect.arrayContaining(['Page 1 / 3', 'Page 2 / 3', 'Page 3 / 3']));
    expect(texts().filter((t: string) => t === 'Tax return 2025').length).toBeGreaterThanOrEqual(4);
  });

  it('throws when a receipt category is not in its section', async () => {
    const broken: TaxReport = {
      ...report,
      sections: [{ ...report.sections[0], categories: [] }],
    };
    await expect(toTaxPdf({ report: broken, labels, locale: 'en' })).rejects.toThrow();
  });
});

describe('taxPdfFileName', () => {
  it('names the file per locale', () => {
    expect(taxPdfFileName({ year: 2025, locale: 'de' })).toBe('steuer-2025.pdf');
    expect(taxPdfFileName({ year: 2025, locale: 'en' })).toBe('tax-return-2025.pdf');
  });
});
