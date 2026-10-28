import { Dialog } from '@angular/cdk/dialog';
import { ApplicationRef, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { TaxSection } from '@hibiscus-frontend/shared/contracts/tax-tags';
import type { Mock } from 'vitest';
import { installMutationObserverMock } from '../../../../core/utils/testing/mutation-observer-mock';
import type { ExportDepth, ExportDocument, ExportOptions } from '../export.model';
import type { PdfResult } from '../export-writers';
import type { PdfLayout } from '../pdf-layout';
import type { ExportSource } from '../transactions-export';
import {
  EXPORT_DIALOG_TITLE_ID,
  EXPORT_FILE_WRITERS,
  EXPORT_PREVIEW_DEBOUNCE_MS,
  ExportDialogComponent,
  type ExportDialogData,
} from './export-dialog.component';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function layout(hitsFloor: boolean): PdfLayout {
  return {
    pageWidthMm: 210,
    pageHeightMm: 297,
    marginMm: 12,
    fontSizePt: 9,
    columnWidthsMm: [],
    wrapColumns: [],
    splitPages: [],
    hitsFloor,
  };
}

function pdf(name: string, hitsFloor = false): PdfResult {
  return { blob: new Blob([name], { type: 'application/pdf' }), layout: layout(hitsFloor) };
}

function section(code: string, name: string): TaxSection {
  return { code, name, form: null, belongs: null, excludes: null, receipts: null, note: null };
}

const SECTIONS: readonly TaxSection[] = [section('St-A', 'Work'), section('St-B', 'Health')];

function doc(options: ExportOptions): ExportDocument {
  const depth: ExportDepth = options.depth;
  const sectionCount: number = options.taxSections?.length ?? 0;
  return {
    title: 'Report',
    scope: { period: 'p', accounts: 'a', search: null },
    columns: [{ id: 'name', header: 'Name', kind: 'text' }],
    rows: Array.from({ length: (depth === 'all' ? 5 : depth + 1) + sectionCount }, () => ({
      kind: 'category' as const,
      level: 0,
      cells: ['Food'],
    })),
  };
}

const PDF_OPTIONS: ExportOptions = {
  format: 'pdf',
  depth: 1,
  taxSections: null,
  page: { format: 'a4', orientation: 'portrait', fit: 'shrink' },
};

const PDF_OPTIONS_CSV: ExportOptions = { ...PDF_OPTIONS, format: 'csv' };

interface FakeWriters {
  readonly toCsv: Mock<(doc: ExportDocument, options: object) => Blob>;
  readonly toJson: Mock<(doc: ExportDocument, exportedAt: Date) => Blob>;
  readonly toPdf: Mock<(doc: ExportDocument, options: object) => Promise<PdfResult>>;
  readonly download: Mock<(blob: Blob, fileName: string) => void>;
}

describe('ExportDialogComponent', () => {
  let appRef: ApplicationRef;
  let writers: FakeWriters;
  let downloadBlob: FakeWriters['download'];
  let build: Mock<(options: ExportOptions) => ExportDocument>;
  let taxSections: WritableSignal<readonly TaxSection[] | null>;
  let remember: Mock<(options: ExportOptions) => void>;
  let createObjectURL: Mock<(blob: Blob) => string>;
  let revokeObjectURL: Mock<(url: string) => void>;

  beforeEach(() => {
    installMutationObserverMock();
    writers = {
      toCsv: vi.fn((): Blob => new Blob(['\uFEFFlevel,Name\r\n0,Food\r\n'], { type: 'text/csv' })),
      toJson: vi.fn((): Blob => new Blob(['{}'], { type: 'application/json' })),
      toPdf: vi.fn(async (): Promise<PdfResult> => pdf('pdf')),
      download: vi.fn(),
    };
    downloadBlob = writers.download;
    TestBed.configureTestingModule({
      providers: [{ provide: EXPORT_FILE_WRITERS, useValue: writers }],
    });
    appRef = TestBed.inject(ApplicationRef);
    build = vi.fn(doc);
    taxSections = signal<readonly TaxSection[] | null>(SECTIONS);
    remember = vi.fn();
    let urls = 0;
    createObjectURL = vi.fn((): string => `blob:preview-${++urls}`);
    revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
  });

  afterEach(() => {
    TestBed.inject(Dialog).closeAll();
  });

  async function settle(ms = 20): Promise<void> {
    appRef.tick();
    await wait(ms);
    appRef.tick();
  }

  async function open(
    initial: ExportOptions,
    view: ExportSource['view'] = 'transactions-by-category',
  ): Promise<HTMLElement> {
    const data: ExportDialogData = {
      source: {
        view,
        maxDepth: view === 'transactions-list' ? null : signal<number>(2),
        taxSections: view === 'transactions-list' ? null : taxSections,
        build,
      },
      scope: signal({
        period: '2026-01-01 – 2026-09-30',
        accounts: '2 of 3 accounts',
        search: null,
      }),
      range: signal({ from: '2026-01-01', to: '2026-09-30' }),
      initial,
      remember,
    };
    TestBed.inject(Dialog).open<void, ExportDialogData>(ExportDialogComponent, {
      data,
      ariaLabelledBy: EXPORT_DIALOG_TITLE_ID,
    });
    await settle();
    const el: HTMLElement | null = document.querySelector('app-export-dialog');
    if (!el) throw new Error('export dialog not rendered');
    return el;
  }

  function button(el: HTMLElement, text: string): HTMLButtonElement {
    const found: HTMLButtonElement | undefined = Array.from(
      el.querySelectorAll<HTMLButtonElement>('button'),
    ).find((candidate: HTMLButtonElement): boolean => candidate.textContent?.trim() === text);
    if (!found) throw new Error(`button "${text}" not rendered`);
    return found;
  }

  it('states the scope', async () => {
    const el: HTMLElement = await open({ ...PDF_OPTIONS, format: 'csv' });
    const scope: string[] = Array.from(el.querySelectorAll('.export-dialog__scope dd')).map(
      (dd: Element): string => dd.textContent?.trim() ?? '',
    );
    expect(scope).toEqual(['2026-01-01 – 2026-09-30', '2 of 3 accounts', 'None']);
    expect(el.querySelector('.export-dialog__file')?.textContent).toContain(
      'transactions-by-category_2026-01-01_2026-09-30.csv',
    );
  });

  it('shows the page setup only for PDF and remembers the choice', async () => {
    const el: HTMLElement = await open({ ...PDF_OPTIONS, format: 'csv' });
    expect(el.querySelector('.export-dialog__page')).toBeNull();
    expect(button(el, 'CSV').getAttribute('aria-pressed')).toBe('true');

    button(el, 'PDF').click();
    await settle();
    expect(el.querySelector('.export-dialog__page')).not.toBeNull();
    expect(el.querySelector('#export-paper')).not.toBeNull();
    expect(el.querySelectorAll('input[name="export-fit"]').length).toBe(3);
    expect(remember).toHaveBeenLastCalledWith(expect.objectContaining({ format: 'pdf' }));

    button(el, 'JSON').click();
    await settle();
    expect(el.querySelector('.export-dialog__page')).toBeNull();
    expect(button(el, 'Export JSON')).not.toBeNull();
  });

  it('offers the detail level only for the by-category report', async () => {
    const el: HTMLElement = await open({ ...PDF_OPTIONS, format: 'csv' });
    const slider: HTMLInputElement | null = el.querySelector('#export-depth');
    if (!slider) throw new Error('slider not rendered');
    expect(slider.getAttribute('aria-valuetext')).toBe('Top-level categories');
    const ticks: string[] = Array.from(el.querySelectorAll('.export-dialog__tick')).map(
      (tick: Element): string => tick.textContent?.trim() ?? '',
    );
    expect(ticks).toEqual(['Level 1', 'Level 2', 'Transactions']);

    slider.value = '2';
    slider.dispatchEvent(new Event('input'));
    await settle();
    expect(slider.getAttribute('aria-valuetext')).toBe('Every transaction');
    expect(build).toHaveBeenLastCalledWith(expect.objectContaining({ depth: 'all' }));
    expect(el.textContent).toContain('5 rows in the file');

    TestBed.inject(Dialog).closeAll();
    const list: HTMLElement = await open({ ...PDF_OPTIONS, format: 'csv' }, 'transactions-list');
    expect(list.querySelector('#export-depth')).toBeNull();
    expect(list.textContent).toContain('Export transactions');
  });

  function taxBoxes(el: HTMLElement): HTMLInputElement[] {
    return Array.from(el.querySelectorAll<HTMLInputElement>('.export-dialog__tax-list input'));
  }

  it('limits the report to ticked tax sections and builds with them', async () => {
    const el: HTMLElement = await open({ ...PDF_OPTIONS, format: 'csv' });
    const toggle: HTMLInputElement | null = el.querySelector('.export-dialog__taxes input');
    if (!toggle) throw new Error('switch not rendered');
    expect(toggle.checked).toBe(false);
    expect(taxBoxes(el).length).toBe(0);

    toggle.click();
    await settle();
    expect(taxBoxes(el).map((box) => box.checked)).toEqual([true, true]);
    expect(el.querySelector('.export-dialog__tax-list')?.textContent).toContain('St-A – Work');
    expect(build).toHaveBeenLastCalledWith(
      expect.objectContaining({ taxSections: ['St-A', 'St-B'] }),
    );
    expect(el.textContent).toContain('4 rows in the file');

    taxBoxes(el)[0].click();
    await settle();
    expect(build).toHaveBeenLastCalledWith(expect.objectContaining({ taxSections: ['St-B'] }));
    expect(remember).toHaveBeenLastCalledWith(expect.objectContaining({ taxSections: ['St-B'] }));
    expect(el.textContent).toContain('3 rows in the file');

    toggle.click();
    await settle();
    expect(build).toHaveBeenLastCalledWith(expect.objectContaining({ taxSections: null }));
  });

  it('disables Export with a hint while no section is ticked', async () => {
    const el: HTMLElement = await open({ ...PDF_OPTIONS, format: 'csv', taxSections: ['St-A'] });
    taxBoxes(el)[0].click();
    await settle();
    expect(button(el, 'Export CSV').disabled).toBe(true);
    expect(el.querySelector('.export-dialog__taxes .export-dialog__warning')).not.toBeNull();

    taxBoxes(el)[1].click();
    await settle();
    expect(button(el, 'Export CSV').disabled).toBe(false);
  });

  it('drops remembered codes that no longer exist', async () => {
    const el: HTMLElement = await open({
      ...PDF_OPTIONS,
      format: 'csv',
      taxSections: ['St-A', 'St-GONE'],
    });
    expect(taxBoxes(el).map((box) => box.checked)).toEqual([true, false]);
    expect(remember).toHaveBeenLastCalledWith(expect.objectContaining({ taxSections: ['St-A'] }));
  });

  it('disables the switch and Export while the sections load; the list has no filter', async () => {
    taxSections.set(null);
    const el: HTMLElement = await open({ ...PDF_OPTIONS, format: 'csv' });
    expect(el.querySelector<HTMLInputElement>('.export-dialog__taxes input')?.disabled).toBe(true);
    expect(button(el, 'Export CSV').disabled).toBe(true);
    expect(el.textContent).toContain('Loading tax sections');

    taxSections.set(SECTIONS);
    await settle();
    expect(button(el, 'Export CSV').disabled).toBe(false);

    TestBed.inject(Dialog).closeAll();
    const list: HTMLElement = await open({ ...PDF_OPTIONS, format: 'csv' }, 'transactions-list');
    expect(list.querySelector('.export-dialog__taxes')).toBeNull();
  });

  it('builds, writes and downloads the file on Export, then closes', async () => {
    const el: HTMLElement = await open({ ...PDF_OPTIONS, format: 'csv' });
    build.mockClear();
    writers.toCsv.mockClear();
    button(el, 'Export CSV').click();
    await settle();

    expect(build).toHaveBeenCalledWith(PDF_OPTIONS_CSV);
    expect(writers.toCsv).toHaveBeenCalledWith(doc(PDF_OPTIONS_CSV), {
      locale: 'en',
      levelHeader: 'level',
    });
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    expect(downloadBlob.mock.calls[0][1]).toBe(
      'transactions-by-category_2026-01-01_2026-09-30.csv',
    );
    expect(document.querySelector('app-export-dialog')).toBeNull();
  });

  it('writes a PDF with the page setup and names the file .pdf', async () => {
    const el: HTMLElement = await open(PDF_OPTIONS, 'transactions-list');
    button(el, 'Landscape').click();
    await settle();
    writers.toPdf.mockClear();
    button(el, 'Export PDF').click();
    await settle();

    expect(writers.toPdf).toHaveBeenCalledTimes(1);
    expect(writers.toPdf.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        locale: 'en',
        page: { format: 'a4', orientation: 'landscape', fit: 'shrink' },
      }),
    );
    expect(downloadBlob.mock.calls[0][1]).toBe('transactions-list_2026-01-01_2026-09-30.pdf');
  });

  it('shows the first lines of a CSV as the preview', async () => {
    const el: HTMLElement = await open({ ...PDF_OPTIONS, format: 'csv' });
    await settle(EXPORT_PREVIEW_DEBOUNCE_MS + 50);
    expect(el.querySelector('.export-dialog__code')?.textContent).toBe('level,Name\n0,Food\n');
  });

  it('discards a stale PDF preview and revokes every shown object URL', async () => {
    const pending: ((result: PdfResult) => void)[] = [];
    writers.toPdf.mockImplementation(
      (): Promise<PdfResult> =>
        new Promise<PdfResult>((resolve: (result: PdfResult) => void): void => {
          pending.push(resolve);
        }),
    );
    const el: HTMLElement = await open(PDF_OPTIONS);
    await settle(EXPORT_PREVIEW_DEBOUNCE_MS + 50);
    expect(pending.length).toBe(1);

    button(el, 'Landscape').click();
    await settle(EXPORT_PREVIEW_DEBOUNCE_MS + 50);
    expect(pending.length).toBe(2);

    // The newer preview arrives first; the older one finishing later must not replace it.
    pending[1](pdf('landscape', true));
    await settle();
    pending[0](pdf('portrait'));
    await settle();

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const frame: HTMLIFrameElement | null = el.querySelector('iframe.export-dialog__frame');
    expect(frame?.getAttribute('src')).toBe('blob:preview-1#view=FitH&navpanes=0');
    expect(frame?.getAttribute('title')).toBe('PDF preview');
    expect(el.querySelector('.export-dialog__warning')).not.toBeNull();

    TestBed.inject(Dialog).closeAll();
    await settle();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');
  });
});
