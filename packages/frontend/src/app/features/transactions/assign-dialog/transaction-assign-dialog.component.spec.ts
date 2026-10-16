import type { Mock } from 'vitest';
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
import { TransactionDialogs } from '../transaction-dialogs';
import { account, transaction, transactionsResponse } from '../testing/transaction-fixture';
import { TransactionsStore } from '../transactions.store';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('TransactionAssignDialogComponent', () => {
  let httpMock: HttpTestingController;
  let service: TransactionDialogs;
  let appRef: ApplicationRef;

  async function setup(...rows: TransactionRow[]): Promise<void> {
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
    httpMock.expectOne('/api/accounts').flush([account()]);
    httpMock.expectOne('/api/transactions').flush(transactionsResponse(rows));
    httpMock
      .expectOne('/api/categories')
      .flush([
        categoryRow({ id: 1, name: 'Living' }),
        categoryRow({ id: 2, name: 'Rent', parent_id: 1 }),
        categoryRow({ id: 3, name: 'Food', parent_id: 1 }),
      ]);
    await settle();
  }

  afterEach(() => {
    TestBed.inject(Dialog).closeAll();
    httpMock.verify();
  });

  async function settle(): Promise<void> {
    appRef.tick();
    await wait(50);
    appRef.tick();
  }

  function storeRow(index = 0): TransactionRow {
    return TestBed.inject(TransactionsStore).transactions()[index];
  }

  async function open(onAssigned?: () => void, count = 1): Promise<HTMLElement> {
    service.openAssign(
      Array.from({ length: count }, (_: unknown, index: number) => storeRow(index)),
      onAssigned,
    );
    await settle();
    return dialog();
  }

  function dialog(): HTMLElement {
    const el: HTMLElement | null = document.querySelector('app-transaction-assign-dialog');
    if (!el) throw new Error('assign dialog not rendered');
    return el;
  }

  function button(label: string): HTMLButtonElement {
    const found: HTMLButtonElement | undefined = Array.from(
      dialog().querySelectorAll<HTMLButtonElement>('button'),
    ).find((el: HTMLButtonElement) => el.textContent?.trim() === label);
    if (!found) throw new Error(`button "${label}" not rendered`);
    return found;
  }

  function treeRow(name: string): HTMLTableRowElement {
    const found: HTMLTableRowElement | undefined = Array.from(
      dialog().querySelectorAll<HTMLTableRowElement>('tbody tr'),
    ).find((el: HTMLTableRowElement) => el.textContent?.trim() === name);
    if (!found) throw new Error(`tree row "${name}" not rendered`);
    return found;
  }

  function post(): TestRequest {
    return httpMock.expectOne({ method: 'POST', url: '/api/transactions/assign-category' });
  }

  const assigned: Partial<TransactionRow> = { id: 7, kommentar: 'Old note', umsatztyp_id: 2 };

  it('shows the current category and focuses the search field', async () => {
    await setup(transaction(assigned));
    await open();

    expect(dialog().querySelector('[role="status"]')?.textContent?.trim()).toBe('Living / Rent');
    expect(button('No category').disabled).toBe(false);
    expect(document.activeElement).toBe(dialog().querySelector('input[type="search"]'));
  });

  it('a pick saves at once with the comment unchanged and closes', async () => {
    await setup(transaction(assigned));
    await open();

    treeRow('Food').click();
    await settle();
    const request: TestRequest = post();
    expect(request.request.body).toEqual({
      items: [{ id: 7, expected: { kommentar: 'Old note', umsatztyp_id: 2 } }],
      umsatztyp_id: 3,
    });
    request.flush(null, { status: 204, statusText: 'No Content' });
    await settle();

    expect(document.querySelector('app-transaction-assign-dialog')).toBeNull();
    expect(storeRow().umsatztyp_id).toBe(3);
    expect(storeRow().kommentar).toBe('Old note');
  });

  it('picking the current category does nothing', async () => {
    await setup(transaction(assigned));
    await open();

    treeRow('Rent').click();
    await settle();

    httpMock.expectNone('/api/transactions/assign-category');
    expect(dialog()).toBeTruthy();
  });

  it('"No category" unassigns', async () => {
    await setup(transaction(assigned));
    await open();

    button('No category').click();
    const request: TestRequest = post();
    expect((request.request.body as { umsatztyp_id: unknown }).umsatztyp_id).toBeNull();
    request.flush(null, { status: 204, statusText: 'No Content' });
    await settle();

    expect(storeRow().umsatztyp_id).toBeNull();
    expect(document.querySelector('app-transaction-assign-dialog')).toBeNull();
  });

  it('"No category" is disabled when nothing is assigned', async () => {
    await setup(transaction({ id: 7, umsatztyp_id: null }));
    await open();

    expect(dialog().querySelector('[role="status"]')?.textContent?.trim()).toBe('No category');
    expect(button('No category').disabled).toBe(true);
  });

  it('a second pick while saving sends no second request', async () => {
    await setup(transaction(assigned));
    await open();

    treeRow('Food').click();
    treeRow('Living').click();
    await settle();

    post().flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    expect(storeRow().umsatztyp_id).toBe(3);
  });

  it('a 409 shows the conflict message and blocks further picks', async () => {
    await setup(transaction(assigned));
    await open();

    treeRow('Food').click();
    await settle();
    post().flush({ error: 'conflict' }, { status: 409, statusText: 'Conflict' });
    await settle();

    expect(dialog().querySelector('[role="alert"]')?.textContent).toContain('changed elsewhere');
    expect(button('No category').disabled).toBe(true);
    treeRow('Living').click();
    await settle();
    httpMock.expectNone('/api/transactions/assign-category');
    expect(storeRow().umsatztyp_id).toBe(2);
  });

  it('another failure shows a generic message and allows a retry', async () => {
    await setup(transaction(assigned));
    await open();

    treeRow('Food').click();
    await settle();
    post().flush(null, { status: 500, statusText: 'Server Error' });
    await settle();
    expect(dialog().querySelector('[role="alert"]')?.textContent).toContain('Could not save');

    treeRow('Food').click();
    await settle();
    post().flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    expect(storeRow().umsatztyp_id).toBe(3);
  });

  describe('several rows', () => {
    const rowA: TransactionRow = transaction({ id: 7, umsatztyp_id: 2, kommentar: 'A' });
    const rowB: TransactionRow = transaction({ id: 8, umsatztyp_id: 3, kommentar: 'B' });

    it('shows the count and "Mixed categories" without a preselection', async () => {
      await setup(rowA, rowB);
      await open(undefined, 2);
      expect(dialog().querySelector('.transaction-assign__summary')?.textContent?.trim()).toBe(
        '2 transactions',
      );
      expect(dialog().querySelector('[role="status"]')?.textContent?.trim()).toBe(
        'Mixed categories',
      );
      expect(button('No category').disabled).toBe(false);
    });

    it('a pick saves all rows in one request, calls onAssigned and closes', async () => {
      await setup(rowA, rowB);
      const onAssigned: Mock<() => void> = vi.fn<() => void>();
      await open(onAssigned, 2);
      treeRow('Living').click();
      await settle();
      const request: TestRequest = post();
      expect(request.request.body).toEqual({
        items: [
          { id: 7, expected: { kommentar: 'A', umsatztyp_id: 2 } },
          { id: 8, expected: { kommentar: 'B', umsatztyp_id: 3 } },
        ],
        umsatztyp_id: 1,
      });
      expect(onAssigned).not.toHaveBeenCalled();
      request.flush(null, { status: 204, statusText: 'No Content' });
      await settle();
      expect(onAssigned).toHaveBeenCalledTimes(1);
      expect(storeRow(0).umsatztyp_id).toBe(1);
      expect(storeRow(1).umsatztyp_id).toBe(1);
      expect(document.querySelector('app-transaction-assign-dialog')).toBeNull();
    });

    it('picking the category all rows share does nothing', async () => {
      await setup(transaction({ id: 7, umsatztyp_id: 2 }), transaction({ id: 8, umsatztyp_id: 2 }));
      await open(undefined, 2);
      expect(dialog().querySelector('[role="status"]')?.textContent?.trim()).toBe('Living / Rent');
      treeRow('Rent').click();
      await settle();
      httpMock.expectNone('/api/transactions/assign-category');
    });

    it('a 409 reports how many rows changed and does not call onAssigned', async () => {
      await setup(rowA, rowB);
      const onAssigned: Mock<() => void> = vi.fn<() => void>();
      await open(onAssigned, 2);
      treeRow('Living').click();
      await settle();
      post().flush(
        { error: 'conflict', conflictIds: [8] },
        { status: 409, statusText: 'Conflict' },
      );
      await settle();
      expect(dialog().querySelector('[role="alert"]')?.textContent).toContain(
        '1 of the selected transactions were changed elsewhere',
      );
      expect(onAssigned).not.toHaveBeenCalled();
      expect(storeRow(0).umsatztyp_id).toBe(2);
    });
  });

  it('Cancel closes without a request', async () => {
    await setup(transaction(assigned));
    await open();

    button('Cancel').click();
    await settle();
    expect(document.querySelector('app-transaction-assign-dialog')).toBeNull();
  });
});
