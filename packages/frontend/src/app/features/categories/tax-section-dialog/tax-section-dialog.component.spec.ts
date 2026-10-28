import { Dialog } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { ApplicationRef, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
  TaxSection,
  TaxSectionCode,
  TaxSectionUpdateRequest,
  TaxTagCode,
} from '@hibiscus-frontend/shared/contracts/tax-tags';
import { EMPTY, Subject, of, throwError, type Observable } from 'rxjs';
import { TaxSectionsService } from '../../../core/services/tax-sections.service';
import { TaxTagsService } from '../../../core/services/tax-tags.service';
import { installMutationObserverMock } from '../../../core/utils/testing/mutation-observer-mock';
import { TaxSectionDialogs } from './tax-section-dialogs';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function section(code: string, name: string): TaxSection {
  return {
    code,
    name,
    form: 'Anlage N',
    belongs: null,
    excludes: null,
    receipts: null,
    note: null,
  };
}

function conflict(kind: string): HttpErrorResponse {
  return new HttpErrorResponse({ status: 409, error: { error: kind } });
}

describe('TaxSectionDialogComponent', () => {
  let sections: WritableSignal<readonly TaxSection[] | null>;
  let tags: WritableSignal<ReadonlyMap<number, TaxTagCode> | null>;
  let create: ReturnType<typeof vi.fn<(s: TaxSection) => Observable<TaxSection>>>;
  let update: ReturnType<
    typeof vi.fn<(code: TaxSectionCode, request: TaxSectionUpdateRequest) => Observable<void>>
  >;
  let remove: ReturnType<typeof vi.fn<(code: TaxSectionCode) => Observable<void>>>;
  let load: ReturnType<typeof vi.fn<() => Observable<void>>>;
  let appRef: ApplicationRef;

  beforeEach(() => {
    installMutationObserverMock();
    sections = signal<readonly TaxSection[] | null>([
      section('St-VA', 'Insurance'),
      section('St-WK', 'Work costs'),
    ]);
    tags = signal<ReadonlyMap<number, TaxTagCode> | null>(
      new Map<number, TaxTagCode>([
        [1, 'St-WK'],
        [2, 'St-WK'],
        [3, 'St-0'],
      ]),
    );
    create = vi.fn<(s: TaxSection) => Observable<TaxSection>>();
    update = vi.fn<(code: TaxSectionCode, request: TaxSectionUpdateRequest) => Observable<void>>();
    remove = vi.fn<(code: TaxSectionCode) => Observable<void>>();
    load = vi.fn<() => Observable<void>>(() => EMPTY);
    TestBed.configureTestingModule({
      providers: [
        TaxSectionDialogs,
        { provide: TaxTagsService, useValue: { tags, load: () => EMPTY } },
        { provide: TaxSectionsService, useValue: { sections, load, create, update, remove } },
      ],
    });
    appRef = TestBed.inject(ApplicationRef);
  });

  afterEach(() => TestBed.inject(Dialog).closeAll());

  async function settle(): Promise<void> {
    appRef.tick();
    await wait(20);
    appRef.tick();
  }

  async function open(): Promise<void> {
    TestBed.inject(TaxSectionDialogs).open();
    await settle();
  }

  function dialog(): HTMLElement {
    const el: HTMLElement | null = document.querySelector('app-tax-section-dialog');
    if (!el) throw new Error('tax section dialog not rendered');
    return el;
  }

  function button(label: string): HTMLButtonElement {
    const found: HTMLButtonElement | undefined = Array.from(
      dialog().querySelectorAll<HTMLButtonElement>('button'),
    ).find((el: HTMLButtonElement) => el.textContent?.trim() === label);
    if (!found) throw new Error(`button "${label}" not rendered`);
    return found;
  }

  function head(code: string): HTMLButtonElement {
    const found: HTMLButtonElement | undefined = Array.from(
      dialog().querySelectorAll<HTMLButtonElement>('.tax-sections__head'),
    ).find(
      (el: HTMLButtonElement) => el.querySelector('app-tax-code')?.textContent?.trim() === code,
    );
    if (!found) throw new Error(`row "${code}" not rendered`);
    return found;
  }

  function field(id: string): HTMLInputElement {
    const el: HTMLInputElement | null = dialog().querySelector<HTMLInputElement>(`#${id}`);
    if (!el) throw new Error(`field #${id} not rendered`);
    return el;
  }

  async function type(id: string, value: string): Promise<void> {
    const el: HTMLInputElement = field(id);
    el.value = value;
    el.dispatchEvent(new Event('input'));
    await settle();
  }

  async function click(el: HTMLButtonElement): Promise<void> {
    el.click();
    await settle();
  }

  function text(): string {
    return dialog().textContent ?? '';
  }

  it('lists the sections with their usage, all collapsed', async () => {
    await open();

    expect(head('St-WK').getAttribute('aria-expanded')).toBe('false');
    expect(head('St-WK').textContent).toContain('Used: 2');
    expect(head('St-VA').textContent).toContain('Used: 0');
    expect(dialog().querySelector('.tax-sections__editor')).toBeNull();
  });

  it('opens a row, saves the edit over the section it started from', async () => {
    update.mockReturnValue(of(undefined));
    await open();
    await click(head('St-WK'));

    expect(head('St-WK').getAttribute('aria-expanded')).toBe('true');
    expect(field('tax-section-name').value).toBe('Work costs');
    expect(text()).toContain('Used by 2 categories.');
    expect(button('Save changes').disabled).toBe(true);

    await type('tax-section-name', 'Work expenses');
    await type('tax-section-note', 'Keep it short');
    await click(button('Save changes'));

    expect(update).toHaveBeenCalledWith('St-WK', {
      expected: section('St-WK', 'Work costs'),
      next: { ...section('St-WK', 'Work expenses'), note: 'Keep it short' },
    });
    expect(button('Saved').disabled).toBe(true);
  });

  it('creates a new section from an unsaved row at the top', async () => {
    const stored: TaxSection = { ...section('St-KI', 'Childcare'), form: 'Anlage Kind' };
    create.mockReturnValue(of(stored));
    await open();
    await click(button('+ New section'));

    const heads: HTMLButtonElement[] = Array.from(
      dialog().querySelectorAll<HTMLButtonElement>('.tax-sections__head'),
    );
    expect(heads).toHaveLength(3);
    expect(heads[0].textContent).toContain('unsaved');
    expect(document.activeElement).toBe(field('tax-section-code'));

    await type('tax-section-code', 'St-KI');
    await type('tax-section-name', 'Childcare');
    await type('tax-section-form', 'Anlage Kind');
    await click(button('Create section'));

    expect(create).toHaveBeenCalledWith(stored);
  });

  it('validates the code: pattern, St-0 and codes already taken', async () => {
    await open();
    await click(head('St-VA'));

    await type('tax-section-code', 'St 1');
    expect(text()).toContain('Use up to 16 letters, digits or hyphens.');
    await type('tax-section-code', 'St-0');
    expect(text()).toContain('St-0 is reserved');
    await type('tax-section-code', 'St-WK');
    expect(text()).toContain('Another section already uses this code.');
    expect(button('Save changes').disabled).toBe(true);

    await type('tax-section-code', 'St-VS');
    expect(button('Save changes').disabled).toBe(false);
  });

  it('shows the server duplicate on the code field', async () => {
    update.mockReturnValue(throwError(() => conflict('duplicate')));
    await open();
    await click(head('St-VA'));
    await type('tax-section-code', 'St-XY');
    await click(button('Save changes'));

    expect(dialog().querySelector('#tax-section-code-error')?.textContent).toContain(
      'Another section already uses this code.',
    );
  });

  it('explains a delete refused because categories still use the section', async () => {
    remove.mockReturnValue(throwError(() => conflict('in-use')));
    await open();
    await click(head('St-WK'));
    await click(button('Delete'));

    expect(remove).toHaveBeenCalledWith('St-WK');
    expect(dialog().querySelector('[role="alert"]')?.textContent).toContain(
      'Used by 2 categories. Retag them first.',
    );
    expect(head('St-WK').getAttribute('aria-expanded')).toBe('true');
  });

  it('on a conflict loads the latest version and reopens the row with it', async () => {
    update.mockReturnValue(throwError(() => conflict('conflict')));
    const reload: Subject<void> = new Subject<void>();
    load.mockReturnValue(reload);
    await open();
    await click(head('St-WK'));
    await type('tax-section-name', 'Mine');
    await click(button('Save changes'));

    expect(text()).toContain('This section was changed elsewhere.');
    expect(button('Save changes').disabled).toBe(true);
    expect(dialog().textContent).not.toContain('Overwrite');

    await click(button('Load latest'));
    sections.set([section('St-VA', 'Insurance'), section('St-WK', 'Theirs')]);
    reload.next();
    reload.complete();
    await settle();

    expect(load).toHaveBeenCalledTimes(1);
    expect(head('St-WK').getAttribute('aria-expanded')).toBe('true');
    expect(field('tax-section-name').value).toBe('Theirs');
    expect(text()).not.toContain('This section was changed elsewhere.');
  });

  it('asks before leaving a row with unsaved changes', async () => {
    await open();
    await click(head('St-WK'));
    await type('tax-section-name', 'Changed');
    await click(head('St-VA'));

    expect(text()).toContain('Discard your unsaved changes?');
    expect(head('St-WK').getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement?.textContent?.trim()).toBe('Keep editing');

    await click(button('Keep editing'));
    expect(text()).not.toContain('Discard your unsaved changes?');
    expect(field('tax-section-name').value).toBe('Changed');

    await click(head('St-VA'));
    await click(button('Discard'));
    expect(head('St-VA').getAttribute('aria-expanded')).toBe('true');
    expect(head('St-WK').getAttribute('aria-expanded')).toBe('false');
    expect(field('tax-section-name').value).toBe('Insurance');
  });

  it('asks before Escape closes the dialog with unsaved changes', async () => {
    await open();
    await click(head('St-WK'));
    await type('tax-section-name', 'Changed');

    dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(text()).toContain('Discard your unsaved changes?');

    await click(button('Discard'));
    expect(document.querySelector('app-tax-section-dialog')).toBeNull();
  });

  it('closes with Done when nothing is unsaved, and with the providing scope', async () => {
    await open();
    await click(button('Done'));
    expect(document.querySelector('app-tax-section-dialog')).toBeNull();

    await open();
    TestBed.resetTestingModule();
    // No `settle()`: the reset destroyed the ApplicationRef it would tick.
    await wait(20);
    expect(document.querySelector('app-tax-section-dialog')).toBeNull();
  });
});
