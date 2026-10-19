import { Dialog } from '@angular/cdk/dialog';
import { ApplicationRef, signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { installMutationObserverMock } from '../../../core/utils/testing/mutation-observer-mock';
import { TransactionsStore } from '../transactions.store';
import type { ExportDocument } from './export.model';
import { TransactionsExport, clampDepth, type ExportSource } from './transactions-export';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const DOC: ExportDocument = {
  title: 'Report',
  scope: { period: 'All dates', accounts: 'All accounts', search: null },
  columns: [{ id: 'name', header: 'Name', kind: 'text' }],
  rows: [{ kind: 'total', level: 0, cells: ['Total'] }],
};

function source(view: ExportSource['view'] = 'transactions-by-category'): ExportSource {
  return {
    view,
    maxDepth: view === 'transactions-list' ? null : signal<number>(2),
    build: (): ExportDocument => DOC,
  };
}

describe('TransactionsExport', () => {
  let service: TransactionsExport;
  let appRef: ApplicationRef;

  beforeEach(() => {
    installMutationObserverMock();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        TransactionsStore,
        TransactionsExport,
      ],
    });
    service = TestBed.inject(TransactionsExport);
    appRef = TestBed.inject(ApplicationRef);
  });

  afterEach(() => {
    // Closed before the preview's debounce runs: these tests are about opening and closing.
    TestBed.inject(Dialog).closeAll();
  });

  async function settle(): Promise<void> {
    appRef.tick();
    await wait(20);
    appRef.tick();
  }

  function dialog(): HTMLElement | null {
    return document.querySelector('app-export-dialog');
  }

  it('throws on open without a registered source', () => {
    expect(() => service.open()).toThrowError(/no export source/);
  });

  it('allows one source at a time and accepts the next after unregister', () => {
    const unregister: () => void = service.register(source());
    expect(() => service.register(source('transactions-list'))).toThrowError(/still registered/);
    unregister();
    expect(() => service.register(source('transactions-list'))).not.toThrow();
  });

  it('opens the dialog for the source and closes it when the source unregisters', async () => {
    const unregister: () => void = service.register(source());
    service.open();
    await settle();
    expect(dialog()).not.toBeNull();
    expect(dialog()?.textContent).toContain('Export by category');

    unregister();
    await settle();
    expect(dialog()).toBeNull();
    expect(() => service.open()).toThrowError(/no export source/);
  });

  it('remembers the last options of a view for the next dialog', async () => {
    service.register(source());
    service.open();
    await settle();
    const json: HTMLButtonElement | undefined = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.app-dialog__segment'),
    ).find((button: HTMLButtonElement): boolean => button.textContent?.trim() === 'JSON');
    if (!json) throw new Error('JSON button not rendered');
    expect(json.getAttribute('aria-pressed')).toBe('false');
    json.click();
    await settle();

    TestBed.inject(Dialog).closeAll();
    await settle();
    service.open();
    await settle();
    const pressed: string[] = Array.from(
      document.querySelectorAll('.app-dialog__segment[aria-pressed="true"]'),
    ).map((button: Element): string => button.textContent?.trim() ?? '');
    expect(pressed).toEqual(['JSON']);
  });
});

describe('clampDepth', () => {
  it('keeps a depth the report has and clamps a deeper one', () => {
    expect(clampDepth(2, 3)).toBe(2);
    expect(clampDepth(4, 3)).toBe(3);
    expect(clampDepth('all', 3)).toBe('all');
    expect(clampDepth(2, 0)).toBe('all');
    expect(clampDepth(5, null)).toBe(5);
  });
});
