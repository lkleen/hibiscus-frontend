import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import { categoryRow } from '../../../core/utils/testing/category-row-fixture';
import { installMutationObserverMock } from '../../../core/utils/testing/mutation-observer-mock';
import { account, transaction, transactionsResponse } from '../testing/transaction-fixture';
import { TransactionsStore } from '../transactions.store';
import { TransactionsByCategoryComponent } from './transactions-by-category.component';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Loaded {
  accounts?: AccountRow[];
  items?: TransactionRow[];
  categories?: CategoryRow[];
}

describe('TransactionsByCategoryComponent', () => {
  let fixture: ComponentFixture<TransactionsByCategoryComponent>;
  let httpMock: HttpTestingController;
  let root: HTMLElement;

  beforeEach(() => {
    installMutationObserverMock();
    TestBed.configureTestingModule({
      imports: [TransactionsByCategoryComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), TransactionsStore],
    });
    fixture = TestBed.createComponent(TransactionsByCategoryComponent);
    httpMock = TestBed.inject(HttpTestingController);
    root = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    fixture.destroy();
    httpMock.verify();
  });

  async function load({
    accounts = [account({ id: 1 })],
    items = [],
    categories = [],
  }: Loaded = {}): Promise<void> {
    fixture.detectChanges();
    httpMock.expectOne('/api/accounts').flush(accounts);
    httpMock.expectOne('/api/transactions').flush(transactionsResponse(items));
    httpMock.expectOne('/api/categories').flush(categories);
    fixture.detectChanges();
    await fixture.whenStable();
    await wait(50);
    fixture.detectChanges();
  }

  function rowTexts(): string[] {
    return Array.from(root.querySelectorAll<HTMLElement>('tbody tr')).map((row) =>
      (row.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
  }

  it('shows categories with their summed amounts and the unassigned node', async () => {
    await load({
      categories: [categoryRow({ id: 1, name: 'Housing', pattern: 'rent' })],
      items: [
        transaction({ id: 1, zweck: 'rent', betrag: -100 }),
        transaction({ id: 2, zweck: 'rent', betrag: -50 }),
        transaction({ id: 3, zweck: 'other', betrag: 20 }),
      ],
    });

    const rows: string[] = rowTexts();
    expect(rows.length).toBe(2);
    const housing: string | undefined = rows.find((row) => row.includes('Housing'));
    expect(housing).toContain('-150.00');
    const unassigned: string | undefined = rows.find((row) => row.includes('Unassigned'));
    expect(unassigned).toContain('20.00');
  });

  it('shows the unassigned node with 0 when nothing is unassigned', async () => {
    await load();

    const rows: string[] = rowTexts();
    expect(rows.length).toBe(1);
    expect(rows[0]).toContain('Unassigned');
    expect(rows[0]).toContain('0.00');
  });

  it('warns about invalid regex patterns, naming the categories', async () => {
    await load({
      categories: [categoryRow({ id: 1, name: 'Broken', pattern: '(', isregex: 1 })],
      items: [transaction({ id: 1 })],
    });

    const warning: HTMLElement | null = root.querySelector('.by-category__warning');
    expect(warning?.textContent).toContain('Broken');
  });

  it('shows no warning when every pattern is valid', async () => {
    await load({ categories: [categoryRow({ id: 1, pattern: 'x' })] });

    expect(root.querySelector('.by-category__warning')).toBeNull();
  });
});
