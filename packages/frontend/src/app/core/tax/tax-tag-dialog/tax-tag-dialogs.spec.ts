import { Dialog } from '@angular/cdk/dialog';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import { TaxTagsService } from '../../services/tax-tags.service';
import { categoryRow } from '../../utils/testing/category-row-fixture';
import { installMutationObserverMock } from '../../utils/testing/mutation-observer-mock';
import { TaxTagDialogs } from './tax-tag-dialogs';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('TaxTagDialogs', () => {
  const categories: CategoryRow[] = [
    categoryRow({ id: 3, name: 'Gesundheit' }),
    categoryRow({ id: 4, name: 'Brille', parent_id: 3 }),
  ];
  let httpMock: HttpTestingController;
  let service: TaxTagDialogs;
  let results: boolean[];

  beforeEach(async () => {
    installMutationObserverMock();
    TestBed.configureTestingModule({
      providers: [TaxTagDialogs, provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    service = TestBed.inject(TaxTagDialogs);
    results = [];
    TestBed.inject(TaxTagsService).load().subscribe();
    httpMock.expectOne('/api/tax-tags').flush([{ category_id: 3, code: 'St-AB' }]);
    service.openSection(categories[1]).subscribe((r: boolean) => results.push(r));
    httpMock.expectOne('/api/categories').flush(categories);
    await settle();
  });

  afterEach(() => TestBed.inject(Dialog).closeAll());

  async function settle(): Promise<void> {
    TestBed.inject(ApplicationRef).tick();
    await wait(50);
    TestBed.inject(ApplicationRef).tick();
  }

  function button(text: string): HTMLButtonElement {
    const found: HTMLButtonElement | undefined = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.app-dialog__footer button'),
    ).find((b) => (b.textContent ?? '').includes(text));
    if (!found) throw new Error(`no button "${text}"`);
    return found;
  }

  function radio(value: string): HTMLInputElement {
    const found: HTMLInputElement | null = document.querySelector(
      `input[type=radio][value="${value}"]`,
    );
    if (!found) throw new Error(`no radio ${value}`);
    return found;
  }

  it('shows the inherited section as the "same as" option and saves nothing unchanged', () => {
    expect(document.querySelector('.app-dialog')?.textContent).toContain('Same as “Gesundheit”');
    expect(radio('inherit').checked).toBe(true);
    expect(button('Save tax section').disabled).toBe(true);
  });

  it('saves the picked section and closes with true', async () => {
    radio('St-SA').click();
    await settle();
    button('Save tax section').click();
    const req = httpMock.expectOne('/api/tax-tags');
    expect(req.request.body).toEqual({
      changes: [{ category_id: 4, expected: null, next: 'St-SA' }],
    });
    req.flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    expect(results).toEqual([true]);
    expect(document.querySelector('app-tax-tag-section-dialog')).toBeNull();
  });

  it('stays open with the reloaded value on a conflict', async () => {
    radio('St-SA').click();
    await settle();
    button('Save tax section').click();
    httpMock
      .expectOne('/api/tax-tags')
      .flush({ error: 'conflict', conflictIds: [4] }, { status: 409, statusText: 'Conflict' });
    httpMock.expectOne('/api/tax-tags').flush([{ category_id: 4, code: 'St-V' }]);
    await settle();
    expect(document.querySelector('.app-dialog__error')).not.toBeNull();
    expect(radio('St-V').checked).toBe(true);
    expect(results).toEqual([]);
  });

  it('closes with false on cancel', async () => {
    button('Cancel').click();
    await settle();
    expect(results).toEqual([false]);
  });
});
