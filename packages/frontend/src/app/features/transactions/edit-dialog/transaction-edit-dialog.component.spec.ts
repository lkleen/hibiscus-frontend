import { Dialog } from '@angular/cdk/dialog';
import { ApplicationRef } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import { categoryRow } from '../../../core/utils/testing/category-row-fixture';
import { installMutationObserverMock } from '../../../core/utils/testing/mutation-observer-mock';
import { account, transaction, transactionsResponse } from '../testing/transaction-fixture';
import { TransactionsStore } from '../transactions.store';
import { TransactionDialogs } from '../transaction-dialogs';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('TransactionEditDialogComponent', () => {
  let httpMock: HttpTestingController;
  let service: TransactionDialogs;
  let appRef: ApplicationRef;
  let row: TransactionRow;

  beforeEach(async () => {
    installMutationObserverMock();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        TransactionsStore,
        TransactionDialogs,
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    service = TestBed.inject(TransactionDialogs);
    appRef = TestBed.inject(ApplicationRef);
    row = transaction({ id: 7, kommentar: 'Old note', umsatztyp_id: 2, zweck: 'Rent' });
    httpMock.expectOne('/api/accounts').flush([account()]);
    httpMock.expectOne('/api/transactions').flush(transactionsResponse([row]));
    httpMock
      .expectOne('/api/categories')
      .flush([
        categoryRow({ id: 1, name: 'Living' }),
        categoryRow({ id: 2, name: 'Rent', parent_id: 1 }),
        categoryRow({ id: 3, name: 'Food', parent_id: 1 }),
      ]);
    await settle();
  });

  afterEach(() => {
    TestBed.inject(Dialog).closeAll();
    httpMock.verify();
  });

  async function settle(): Promise<void> {
    appRef.tick();
    await wait(50);
    appRef.tick();
  }

  /** The row the store holds (the raw one the dialog edits). */
  function storeRow(): TransactionRow {
    return TestBed.inject(TransactionsStore).transactions()[0];
  }

  async function open(): Promise<HTMLElement> {
    service.openEdit(storeRow());
    await settle();
    return dialog();
  }

  function dialog(): HTMLElement {
    const el: HTMLElement | null = document.querySelector('app-transaction-edit-dialog');
    if (!el) throw new Error('edit dialog not rendered');
    return el;
  }

  function button(label: string): HTMLButtonElement {
    const found: HTMLButtonElement | undefined = Array.from(
      dialog().querySelectorAll<HTMLButtonElement>('button'),
    ).find((el: HTMLButtonElement) => el.textContent?.trim() === label);
    if (!found) throw new Error(`button "${label}" not rendered`);
    return found;
  }

  function textarea(): HTMLTextAreaElement {
    const el: HTMLTextAreaElement | null = dialog().querySelector('textarea');
    if (!el) throw new Error('textarea not rendered');
    return el;
  }

  async function typeComment(text: string): Promise<void> {
    const el: HTMLTextAreaElement = textarea();
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
  }

  function treeRow(name: string): HTMLTableRowElement {
    const found: HTMLTableRowElement | undefined = Array.from(
      dialog().querySelectorAll<HTMLTableRowElement>('tbody tr'),
    ).find((el: HTMLTableRowElement) => el.textContent?.trim() === name);
    if (!found) throw new Error(`tree row "${name}" not rendered`);
    return found;
  }

  function patch(): TestRequest {
    return httpMock.expectOne({ method: 'PATCH', url: '/api/transactions/7' });
  }

  it('prefills the comment and the category and keeps Save disabled until something changes', async () => {
    await open();

    expect(textarea().value).toBe('Old note');
    expect(dialog().querySelector('[role="status"]')?.textContent?.trim()).toBe('Living / Rent');
    expect(dialog().textContent).toContain('Rent');
    expect(button('Save').disabled).toBe(true);
    expect(dialog().querySelectorAll('tbody tr.p-treetable-row-selected')).toHaveLength(1);
    // All categories are expanded, the selected one is the current category.
    expect(treeRow('Food')).toBeTruthy();
    expect(document.activeElement).toBe(textarea());
  });

  it('"No category" unsets the category and the save sends null', async () => {
    await open();

    button('No category').click();
    await settle();
    expect(dialog().querySelector('[role="status"]')?.textContent?.trim()).toBe('No category');
    expect(dialog().querySelectorAll('tbody tr.p-treetable-row-selected')).toHaveLength(0);
    expect(button('Save').disabled).toBe(false);

    button('Save').click();
    const request: TestRequest = patch();
    expect(request.request.body).toEqual({
      expected: { kommentar: 'Old note', umsatztyp_id: 2 },
      next: { kommentar: 'Old note', umsatztyp_id: null },
    });
    request.flush(null, { status: 204, statusText: 'No Content' });
    await settle();

    expect(document.querySelector('app-transaction-edit-dialog')).toBeNull();
    expect(storeRow().umsatztyp_id).toBeNull();
  });

  it('picks a category in the tree', async () => {
    await open();

    treeRow('Food').click();
    await settle();
    expect(dialog().querySelector('[role="status"]')?.textContent?.trim()).toBe('Living / Food');

    button('Save').click();
    const request: TestRequest = patch();
    expect(request.request.body).toEqual({
      expected: { kommentar: 'Old note', umsatztyp_id: 2 },
      next: { kommentar: 'Old note', umsatztyp_id: 3 },
    });
    request.flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    expect(storeRow().umsatztyp_id).toBe(3);
  });

  it('saves an emptied comment as null', async () => {
    await open();

    await typeComment('');
    button('Save').click();
    const request: TestRequest = patch();
    expect((request.request.body as { next: unknown }).next).toEqual({
      kommentar: null,
      umsatztyp_id: 2,
    });
    request.flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    expect(storeRow().kommentar).toBeNull();
  });

  it('sends one request on a double click and disables Save while saving', async () => {
    await open();

    await typeComment('New note');
    const save: HTMLButtonElement = button('Save');
    save.click();
    save.click();
    await settle();
    expect(save.disabled).toBe(true);

    patch().flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    expect(storeRow().kommentar).toBe('New note');
  });

  it('shows the conflict message, keeps the dialog open and Save disabled', async () => {
    await open();

    await typeComment('New note');
    button('Save').click();
    patch().flush({ error: 'conflict' }, { status: 409, statusText: 'Conflict' });
    await settle();

    const alert: HTMLElement | null = dialog().querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('changed elsewhere');
    expect(button('Save').disabled).toBe(true);
    expect(storeRow().kommentar).toBe('Old note');
  });

  it('shows a generic error for other failures and lets the user retry', async () => {
    await open();

    await typeComment('New note');
    button('Save').click();
    patch().flush(null, { status: 500, statusText: 'Server Error' });
    await settle();

    expect(dialog().querySelector('[role="alert"]')?.textContent).toContain('Could not save');
    expect(button('Save').disabled).toBe(false);
  });

  it('Cancel closes without a request, and a second open replaces the first dialog', async () => {
    await open();
    await open();
    expect(document.querySelectorAll('app-transaction-edit-dialog')).toHaveLength(1);

    button('Cancel').click();
    await settle();
    expect(document.querySelector('app-transaction-edit-dialog')).toBeNull();
  });
});
