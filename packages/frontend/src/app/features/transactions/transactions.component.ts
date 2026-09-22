import { DatePipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { catchError, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { Account } from '../../core/models/account.model';
import { Category } from '../../core/models/category.model';
import { Transaction, TransactionsQuery } from '../../core/models/transaction.model';
import { CategoryPickerComponent } from './category-picker/category-picker.component';

const PAGE_SIZE = 20;

function sameQuery(a: TransactionsQuery, b: TransactionsQuery): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

@Component({
  selector: 'app-transactions',
  templateUrl: './transactions.component.html',
  styleUrl: './transactions.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, DatePipe, CategoryPickerComponent],
})
export class TransactionsComponent {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly pageSize = PAGE_SIZE;

  protected readonly accounts = signal<Account[]>([]);
  protected readonly categories = signal<Category[]>([]);

  protected readonly accountId = signal<number | null>(null);
  protected readonly from = signal('');
  protected readonly to = signal('');
  protected readonly categoryId = signal<number | null>(null);
  protected readonly q = signal('');
  protected readonly page = signal(1);

  protected readonly items = signal<Transaction[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);
  protected readonly categoryUpdateErrorId = signal<number | null>(null);

  protected readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));
  protected readonly accountsById = computed(
    () => new Map(this.accounts().map((account) => [account.id, account])),
  );

  private readonly query = computed<TransactionsQuery>(() => ({
    accountId: this.accountId() ?? undefined,
    from: this.from() || undefined,
    to: this.to() || undefined,
    categoryId: this.categoryId() ?? undefined,
    q: this.q() || undefined,
    page: this.page(),
    pageSize: PAGE_SIZE,
  }));

  constructor() {
    this.api
      .getAccounts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((accounts) => this.accounts.set(accounts));

    this.api
      .getCategories()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((categories) => this.categories.set(categories));

    toObservable(this.query)
      .pipe(
        debounceTime(200),
        distinctUntilChanged(sameQuery),
        switchMap((query) => {
          this.loading.set(true);
          this.error.set(false);
          return this.api.getTransactions(query).pipe(
            catchError(() => {
              this.error.set(true);
              return of({ items: [], total: 0 });
            }),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((response) => {
        this.items.set(response.items);
        this.total.set(response.total);
        this.loading.set(false);
      });
  }

  protected onAccountChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.accountId.set(value ? Number(value) : null);
    this.page.set(1);
  }

  protected onCategoryFilterChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.categoryId.set(value ? Number(value) : null);
    this.page.set(1);
  }

  protected onFromChange(event: Event): void {
    this.from.set((event.target as HTMLInputElement).value);
    this.page.set(1);
  }

  protected onToChange(event: Event): void {
    this.to.set((event.target as HTMLInputElement).value);
    this.page.set(1);
  }

  protected onSearchInput(event: Event): void {
    this.q.set((event.target as HTMLInputElement).value);
    this.page.set(1);
  }

  protected previousPage(): void {
    this.page.update((p) => Math.max(1, p - 1));
  }

  protected nextPage(): void {
    this.page.update((p) => Math.min(this.totalPages(), p + 1));
  }

  protected onCategoryChange(transaction: Transaction, categoryId: number | null): void {
    this.categoryUpdateErrorId.set(null);
    this.api
      .updateTransactionCategory(transaction.id, { categoryId })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.items.update((items) => items.map((t) => (t.id === updated.id ? updated : t)));
        },
        error: () => this.categoryUpdateErrorId.set(transaction.id),
      });
  }
}
