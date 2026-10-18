import { Dialog } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { ApplicationRef, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type {
  CategoryEditableFields,
  CategoryRow,
} from '@hibiscus-frontend/shared/contracts/categories';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import { Subject } from 'rxjs';
import { categoryRow } from '../../../core/utils/testing/category-row-fixture';
import { installMutationObserverMock } from '../../../core/utils/testing/mutation-observer-mock';
import { account, transaction } from '../../transactions/testing/transaction-fixture';
import { CategoryDialogs } from '../category-dialogs';
import {
  editableFieldsOf,
  type CategoryEditSource,
  type CategorySave,
} from './category-edit-dialog.model';

const NEW_FIELDS: CategoryEditableFields = editableFieldsOf(categoryRow({ name: 'Shop' }));

describe('CategoryEditDialogComponent', () => {
  let service: CategoryDialogs;
  let appRef: ApplicationRef;
  let source: CategoryEditSource;
  let saves: Subject<CategoryRow>;
  let saveCalls: CategorySave[];
  let categories: WritableSignal<readonly CategoryRow[]>;

  beforeEach(() => {
    // Fake from the start: the debounce reuses the timer of its first emission.
    vi.useFakeTimers();
    installMutationObserverMock();
    TestBed.configureTestingModule({ providers: [CategoryDialogs] });
    service = TestBed.inject(CategoryDialogs);
    appRef = TestBed.inject(ApplicationRef);
    saves = new Subject<CategoryRow>();
    saveCalls = [];
    categories = signal<readonly CategoryRow[]>([
      categoryRow({ id: 1, name: 'Living' }),
      categoryRow({ id: 2, name: 'Food', parent_id: 1, pattern: 'bakery' }),
      categoryRow({ id: 3, name: 'Child', parent_id: 2 }),
      categoryRow({ id: 4, name: 'Groceries', pattern: 'market' }),
    ]);
    const accounts: readonly AccountRow[] = [account({ id: 1 })];
    const transactions: readonly TransactionRow[] = [
      transaction({ id: 1, zweck: 'Rewe market', valuta: '2026-09-03' }),
      transaction({ id: 2, zweck: 'Rewe online', umsatztyp_id: 4, valuta: '2026-09-02' }),
      transaction({ id: 3, zweck: 'Rewe plain', valuta: '2026-09-01' }),
      transaction({ id: 4, zweck: 'Rewe kept', umsatztyp_id: 2, valuta: '2026-08-01' }),
      transaction({ id: 5, zweck: 'Other thing', valuta: '2026-07-01' }),
    ];
    source = {
      categories,
      transactions: signal(transactions),
      accounts: signal(accounts),
      accountsById: signal(new Map(accounts.map((a: AccountRow) => [a.id, a]))),
      categoryPathsById: signal(
        new Map<number, string>([
          [1, 'Living'],
          [2, 'Living / Food'],
          [3, 'Living / Food / Child'],
          [4, 'Groceries'],
        ]),
      ),
      saveCategory: (save: CategorySave) => {
        saveCalls.push(save);
        return saves;
      },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    TestBed.inject(Dialog).closeAll();
  });

  async function settle(): Promise<void> {
    appRef.tick();
    await vi.advanceTimersByTimeAsync(50);
    appRef.tick();
  }

  /** Runs the 300 ms debounce of the preview. */
  function flushPreview(): void {
    appRef.tick();
    vi.advanceTimersByTime(300);
    appRef.tick();
  }

  function dialog(): HTMLElement {
    const el: HTMLElement | null = document.querySelector('app-category-edit-dialog');
    if (!el) throw new Error('category dialog not rendered');
    return el;
  }

  function button(label: string): HTMLButtonElement {
    const found: HTMLButtonElement | undefined = Array.from(
      dialog().querySelectorAll<HTMLButtonElement>('button'),
    ).find((el: HTMLButtonElement) => el.textContent?.trim() === label);
    if (!found) throw new Error(`button "${label}" not rendered`);
    return found;
  }

  function input(id: string): HTMLInputElement {
    const el: HTMLInputElement | null = dialog().querySelector<HTMLInputElement>(`#${id}`);
    if (!el) throw new Error(`#${id} not rendered`);
    return el;
  }

  function type(el: HTMLInputElement, text: string): void {
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    appRef.tick();
  }

  function previewRow(text: string): string {
    const found: HTMLTableRowElement | undefined = Array.from(
      dialog().querySelectorAll<HTMLTableRowElement>('app-data-table tbody tr'),
    ).find((el: HTMLTableRowElement) => el.textContent?.includes(text));
    if (!found) throw new Error(`preview row "${text}" not rendered`);
    return found.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  function summary(): string {
    return dialog().querySelector('.category-edit__summary')?.textContent?.trim() ?? '';
  }

  async function openCreate(): Promise<void> {
    service.openCreate(source, NEW_FIELDS);
    await settle();
  }

  async function openEdit(category: CategoryRow): Promise<void> {
    service.openEdit(source, category);
    await settle();
  }

  it('prefills a new category, focuses the name and needs a name to create', async () => {
    await openCreate();

    expect(dialog().querySelector('h2')?.textContent?.trim()).toBe('New category');
    expect(input('category-edit-name').value).toBe('Shop');
    expect(document.activeElement).toBe(input('category-edit-name'));
    expect(button('Create').disabled).toBe(false);
    expect(summary()).toBe('0 matching · 0 assigned here');

    type(input('category-edit-name'), '  ');
    expect(button('Create').disabled).toBe(true);
  });

  it('updates the preview 300 ms after the pattern changed and classifies each hit', async () => {
    await openCreate();

    type(input('category-edit-pattern'), 'rewe');
    appRef.tick();
    expect(summary()).toBe('0 matching · 0 assigned here');
    flushPreview();

    expect(summary()).toBe('4 matching · 1 assigned here');
    expect(previewRow('Rewe plain')).toContain('Assigned here');
    expect(previewRow('Rewe market')).toContain('Claimed first by Groceries');
    expect(previewRow('Rewe online')).toContain('Stored as Groceries');
    expect(previewRow('Rewe kept')).toContain('Stored as Living / Food');
  });

  it('counts a transaction stored in the edited category as stored here', async () => {
    await openEdit(categoryRow({ id: 2, name: 'Food', parent_id: 1, pattern: 'rewe' }));

    expect(previewRow('Rewe kept')).toContain('Stored here');
    expect(previewRow('Rewe plain')).toContain('Assigned here');
  });

  it('disables Create and shows an error for an invalid regular expression', async () => {
    await openCreate();

    type(input('category-edit-pattern'), '(rewe');
    dialog().querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
    appRef.tick();
    flushPreview();

    expect(dialog().querySelector('.category-edit__problem')?.getAttribute('role')).toBe('alert');
    expect(button('Create').disabled).toBe(true);
    expect(summary()).toBe('0 matching · 0 assigned here');
  });

  it('keeps Apply disabled until something changed and sends the draft as an update', async () => {
    const category: CategoryRow = categoryRow({ id: 2, name: 'Food', parent_id: 1, flags: null });
    await openEdit(category);

    expect(button('Apply').disabled).toBe(true);
    type(input('category-edit-name'), 'Groceries 2');
    expect(button('Apply').disabled).toBe(false);

    button('Apply').click();
    appRef.tick();
    const fields: CategoryEditableFields = editableFieldsOf(category);
    expect(saveCalls).toEqual([
      { kind: 'update', category, next: { ...fields, name: 'Groceries 2' } },
    ]);
    expect(button('Apply').disabled).toBe(true);

    saves.next(category);
    await settle();
    expect(document.querySelector('app-category-edit-dialog')).toBeNull();
  });

  it('excludes the category and its subtree from the parent choices', async () => {
    await openEdit(categoryRow({ id: 2, name: 'Food', parent_id: 1 }));

    const text: string = dialog().querySelector('app-category-picker')?.textContent ?? '';
    expect(text).toContain('Living');
    expect(text).toContain('Groceries');
    expect(text).not.toContain('Child');
  });

  it('shows the conflict message and keeps Apply disabled on a 409', async () => {
    await openEdit(categoryRow({ id: 2, name: 'Food', parent_id: 1 }));

    type(input('category-edit-name'), 'Changed');
    button('Apply').click();
    saves.error(new HttpErrorResponse({ status: 409 }));
    appRef.tick();

    expect(dialog().querySelector('.app-dialog__error')?.textContent).toContain(
      'changed elsewhere',
    );
    expect(button('Apply').disabled).toBe(true);
  });

  it('shows the cycle message on a 400 cycle error', async () => {
    await openEdit(categoryRow({ id: 2, name: 'Food', parent_id: 1 }));

    type(input('category-edit-name'), 'Changed');
    button('Apply').click();
    saves.error(new HttpErrorResponse({ status: 400, error: { error: 'cycle' } }));
    appRef.tick();

    expect(dialog().querySelector('.app-dialog__error')?.textContent).toContain('subcategories');
    expect(button('Apply').disabled).toBe(false);
  });
});
