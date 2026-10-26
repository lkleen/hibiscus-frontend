import { HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { categoryRow } from '../../../core/utils/testing/category-row-fixture';
import { installMutationObserverMock } from '../../../core/utils/testing/mutation-observer-mock';
import { transaction } from '../../transactions/testing/transaction-fixture';
import { TaxReturnStore } from '../tax-return.store';
import { flushTaxLoad, taxReturnProviders } from '../testing/tax-return-testing';
import { StepResultComponent } from './step-result.component';

// jspdf is mocked (as in tax-pdf.spec.ts); the real `toTaxPdf` writes into the mock.
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
  getNumberOfPages: vi.fn((): number => 1),
  output: vi.fn((): Blob => new Blob(['pdf'], { type: 'application/pdf' })),
}));

vi.mock('jspdf', () => ({
  jsPDF: function (): unknown {
    return pdfMock;
  },
}));
vi.mock('jspdf-autotable', () => ({ default: autoTable }));

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('StepResultComponent', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<StepResultComponent>;
  let root: HTMLElement;

  beforeEach(() => {
    installMutationObserverMock();
    pdfMock.text.mockClear();
    TestBed.configureTestingModule({
      imports: [StepResultComponent],
      providers: taxReturnProviders(),
    });
    http = TestBed.inject(HttpTestingController);
    const store: TaxReturnStore = TestBed.inject(TaxReturnStore);
    flushTaxLoad(http, {
      categories: [categoryRow({ id: 1, name: 'Handwerker', pattern: 'maler' })],
      tags: [{ category_id: 1, code: 'St-HH' }],
      transactions: [
        transaction({
          id: 1,
          zweck: 'Maler RE 1',
          empfaenger_name: 'Kunz',
          betrag: -980,
          datum: '2025-04-11',
        }),
        transaction({
          id: 2,
          zweck: 'Maler RE 2',
          empfaenger_name: 'Kunz',
          betrag: -360,
          datum: '2025-09-02',
        }),
      ],
    });
    store.year.set(2025);
    fixture = TestBed.createComponent(StepResultComponent);
    root = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    http.verify();
  });

  it('shows one sheet per section with the form, code, totals, categories and note', () => {
    const sheet: HTMLElement | null = root.querySelector('.tax-sheet');
    if (!sheet) throw new Error('no sheet');
    const text: string = sheet.textContent ?? '';
    expect(text).toContain('Anlage Haushaltsnahe Aufwendungen');
    expect(text).toContain('St-HH');
    expect(text).toContain('€1,340.00');
    expect(text).toContain('Handwerker');
    expect(text).toContain('Show the payments (2, receipts 1–2)');
    expect(text).toContain('only when paid by bank transfer');
  });

  it('renders the receipt list once it is opened', async () => {
    const details: HTMLDetailsElement | null = root.querySelector('details');
    if (!details) throw new Error('no receipts');
    expect(details.querySelector('app-data-table')).toBeNull();
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    fixture.detectChanges();
    await wait(50);
    fixture.detectChanges();
    expect(details.querySelector('app-data-table')?.textContent).toContain('Maler RE 2');
  });

  it('downloads the PDF with labels from the translations', async () => {
    const create = vi.fn((): string => 'blob:x');
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() });
    const names: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ): void {
      names.push(this.download);
    });
    const button: HTMLButtonElement | null = root.querySelector('.tax-button--primary');
    if (!button) throw new Error('no download button');

    button.click();
    await wait(50);

    const texts: string[] = pdfMock.text.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(texts).toContain('Tax return 2025');
    expect(names).toEqual(['tax-return-2025.pdf']);
    click.mockRestore();
  });
});
