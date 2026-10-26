import { Dialog } from '@angular/cdk/dialog';
import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import { EMPTY } from 'rxjs';
import { categoryRow } from '../../core/utils/testing/category-row-fixture';
import { installMutationObserverMock } from '../../core/utils/testing/mutation-observer-mock';
import { CategoryDialogs } from './category-dialogs';
import {
  editableFieldsOf,
  type CategoryEditSource,
} from './edit-dialog/category-edit-dialog.model';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('CategoryDialogs', () => {
  const source: CategoryEditSource = {
    categories: signal([categoryRow({ id: 1, name: 'Living' })]),
    transactions: signal([]),
    accounts: signal([]),
    accountsById: signal(new Map()),
    categoryPathsById: signal(new Map()),
    saveCategory: () => EMPTY,
  };

  beforeEach(() => {
    installMutationObserverMock();
    TestBed.configureTestingModule({ providers: [CategoryDialogs] });
  });

  afterEach(() => TestBed.inject(Dialog).closeAll());

  async function settle(): Promise<void> {
    TestBed.inject(ApplicationRef).tick();
    await wait(50);
    TestBed.inject(ApplicationRef).tick();
  }

  it('opens at most one dialog, titled for create or edit, in a wide panel', async () => {
    const service: CategoryDialogs = TestBed.inject(CategoryDialogs);
    const row: CategoryRow = categoryRow({ id: 1, name: 'Living' });

    service.openEdit(source, row);
    await settle();
    service.openCreate(source, editableFieldsOf(row));
    await settle();

    expect(document.querySelectorAll('app-category-edit-dialog')).toHaveLength(1);
    expect(document.querySelector('h2')?.textContent?.trim()).toBe('New category');
    expect(document.querySelector('.app-dialog-panel.app-dialog-panel--wide')).not.toBeNull();
    expect(document.querySelector('.app-dialog-backdrop')).not.toBeNull();
  });

  it('emits the created category once the create dialog closes with it', async () => {
    const service: CategoryDialogs = TestBed.inject(CategoryDialogs);
    const created: CategoryRow = categoryRow({ id: 9, name: 'Shop' });
    const emitted: (CategoryRow | undefined)[] = [];

    service
      .openCreate(source, editableFieldsOf(created))
      .subscribe((row: CategoryRow | undefined) => emitted.push(row));
    await settle();
    TestBed.inject(Dialog).openDialogs[0].close(created);
    await settle();

    expect(emitted).toEqual([created]);
  });

  it('closes the dialog when the providing scope is destroyed', async () => {
    TestBed.inject(CategoryDialogs).openEdit(source, categoryRow({ id: 1, name: 'Living' }));
    await settle();

    TestBed.resetTestingModule();
    await settle();

    expect(document.querySelector('app-category-edit-dialog')).toBeNull();
  });
});
