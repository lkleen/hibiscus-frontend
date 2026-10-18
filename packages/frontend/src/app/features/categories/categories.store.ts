import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import { Observable, forkJoin } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { categoryPaths } from '../../core/utils/category-path';
import type { CategoryEditSource, CategorySave } from './edit-dialog/category-edit-dialog.model';
import { saveCategoryInto } from './save-category';

/**
 * State of the categories page: the data, loaded once when the store is created. Implements
 * `CategoryEditSource` so the category edit dialog can read and save through it.
 */
@Injectable()
export class CategoriesStore implements CategoryEditSource {
  private readonly api = inject(ApiService);

  readonly accounts = signal<readonly AccountRow[]>([]);
  readonly categories = signal<readonly CategoryRow[]>([]);
  readonly transactions = signal<readonly TransactionRow[]>([]);
  readonly loading = signal(true);
  readonly error = signal(false);

  readonly accountsById = computed<ReadonlyMap<number, AccountRow>>(
    () => new Map(this.accounts().map((account: AccountRow) => [account.id, account])),
  );

  /** Every category's root-to-leaf name path, computed once per load. */
  readonly categoryPathsById = computed<ReadonlyMap<number, string>>(() =>
    categoryPaths(this.categories()),
  );

  /**
   * Creates or updates a category. On success the stored row is put into `categories`: appended
   * for a create, replacing the old row in place for an update. Errors propagate, and
   * `categories` stays untouched.
   */
  saveCategory(save: CategorySave): Observable<CategoryRow> {
    return saveCategoryInto(this.api, this.categories, save);
  }

  constructor() {
    forkJoin({
      accounts: this.api.getAccounts(),
      categories: this.api.getCategories(),
      transactions: this.api.getTransactions(),
    })
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe({
        next: ({ accounts, categories, transactions }) => {
          this.accounts.set(accounts);
          this.categories.set(categories);
          this.transactions.set(transactions);
          this.loading.set(false);
        },
        error: () => {
          this.error.set(true);
          this.loading.set(false);
        },
      });
  }
}
