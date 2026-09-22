import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TransactionsComponent } from './transactions.component';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('TransactionsComponent', () => {
  let fixture: ComponentFixture<TransactionsComponent>;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TransactionsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(TransactionsComponent);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('renders the transactions returned by the API', async () => {
    fixture.detectChanges();

    httpMock
      .expectOne('/api/accounts')
      .flush([{ id: 1, name: 'Checking', iban: null, currency: 'EUR', balance: 100 }]);
    httpMock
      .expectOne('/api/categories')
      .flush([{ id: 1, name: 'Groceries', parentId: null, color: '#2f6f4f' }]);

    // The transaction query is debounced (200ms) behind a signal->observable bridge.
    await wait(250);
    fixture.detectChanges();

    const req = httpMock.expectOne((r) => r.url === '/api/transactions');
    req.flush({
      items: [
        {
          id: 1,
          accountId: 1,
          date: '2026-09-01',
          amount: -12.5,
          purpose: 'Weekly shop',
          counterparty: 'Supermarket',
          categoryId: 1,
        },
      ],
      total: 1,
    });

    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows.length).toBe(1);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Supermarket');
    expect(text).toContain('Weekly shop');
    expect(text).toContain('Checking');
  });

  it('shows an empty state when there are no matching transactions', async () => {
    fixture.detectChanges();

    httpMock.expectOne('/api/accounts').flush([]);
    httpMock.expectOne('/api/categories').flush([]);

    await wait(250);
    fixture.detectChanges();

    const req = httpMock.expectOne((r) => r.url === '/api/transactions');
    req.flush({ items: [], total: 0 });

    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('No transactions match these filters.');
  });
});
