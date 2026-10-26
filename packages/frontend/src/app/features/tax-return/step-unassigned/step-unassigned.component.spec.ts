import { Dialog } from '@angular/cdk/dialog';
import { HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import { EMPTY, Subject } from 'rxjs';
import { TaxTagDialogs } from '../../../core/tax/tax-tag-dialog/tax-tag-dialogs';
import { categoryRow } from '../../../core/utils/testing/category-row-fixture';
import { installMutationObserverMock } from '../../../core/utils/testing/mutation-observer-mock';
import type {
  DataTableMenuItem,
  DataTableMenuItemDef,
  DataTableOptions,
} from '../../../shared/components/data-table/data-table.model';
import { CategoryDialogs } from '../../categories/category-dialogs';
import { transaction } from '../../transactions/testing/transaction-fixture';
import { TaxReturnStore } from '../tax-return.store';
import { flushTaxLoad, taxReturnProviders } from '../testing/tax-return-testing';
import { StepUnassignedComponent } from './step-unassigned.component';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const ROWS: TransactionRow[] = [
  transaction({ id: 1, zweck: 'small', empfaenger_name: 'A', betrag: -10, datum: '2025-01-01' }),
  transaction({ id: 2, zweck: 'large', empfaenger_name: 'B', betrag: -980, datum: '2025-02-01' }),
  transaction({ id: 3, zweck: 'income', empfaenger_name: 'C', betrag: 200, datum: '2025-03-01' }),
  transaction({ id: 4, zweck: 'other year', betrag: -5, datum: '2024-03-01' }),
  transaction({ id: 5, zweck: 'rewe', betrag: -5, datum: '2025-03-01' }),
];

describe('StepUnassignedComponent', () => {
  let http: HttpTestingController;
  let store: TaxReturnStore;
  let fixture: ComponentFixture<StepUnassignedComponent>;
  let root: HTMLElement;

  beforeEach(() => {
    installMutationObserverMock();
    TestBed.configureTestingModule({
      imports: [StepUnassignedComponent],
      providers: taxReturnProviders(),
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(TaxReturnStore);
  });

  afterEach(() => {
    TestBed.inject(Dialog).closeAll();
    fixture.destroy();
    http.verify();
  });

  async function render(transactions: TransactionRow[]): Promise<void> {
    flushTaxLoad(http, {
      transactions,
      categories: [categoryRow({ id: 1, name: 'Lebensmittel', pattern: 'rewe' })],
    });
    store.year.set(2025);
    fixture = TestBed.createComponent(StepUnassignedComponent);
    root = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
    await wait(50);
    fixture.detectChanges();
  }

  function bodyRows(): HTMLTableRowElement[] {
    return Array.from(root.querySelectorAll<HTMLTableRowElement>('tbody tr')).filter(
      (row) => !row.querySelector('td[colspan]'),
    );
  }

  it('lists the year’s unassigned transactions, largest amounts first, with count and sum', async () => {
    await render(ROWS);
    expect(root.textContent).toContain('Transactions of 2025 without a category: 3');
    expect(root.textContent).toContain('-€790.00');
    const purposes: string[] = bodyRows().map((row) => row.textContent ?? '');
    expect(purposes).toHaveLength(3);
    expect(purposes[0]).toContain('large');
    expect(purposes[1]).toContain('income');
    expect(purposes[2]).toContain('small');
  });

  it('says so when every transaction of the year has a category', async () => {
    await render([ROWS[3], ROWS[4]]);
    expect(root.textContent).toContain('All transactions of 2025 have a category');
    expect(root.querySelector('app-data-table')).toBeNull();
  });

  it('asks for the tax section of a category created from a row', async () => {
    await render(ROWS);
    const created: Subject<CategoryRow | undefined> = new Subject<CategoryRow | undefined>();
    const openCreate = vi
      .spyOn(TestBed.inject(CategoryDialogs), 'openCreate')
      .mockReturnValue(created);
    const openSection = vi
      .spyOn(TestBed.inject(TaxTagDialogs), 'openSection')
      .mockReturnValue(EMPTY);

    const options: DataTableOptions<TransactionRow> = fixture.componentInstance['options'];
    const getItems = options.getContextMenuItems;
    if (!getItems) throw new Error('no context menu');
    const items: readonly DataTableMenuItem[] = getItems({
      row: ROWS[1],
      column: store.transactions.transactionColumns[0] as never,
      value: null,
      selectedRows: [],
    });
    const create: DataTableMenuItem | undefined = items.find(
      (item) =>
        typeof item === 'object' &&
        'nameKey' in item &&
        item.nameKey === 'transactions.menuCreateCategory',
    );
    (create as DataTableMenuItemDef).action();
    expect(openCreate).toHaveBeenCalledTimes(1);

    const category: CategoryRow = categoryRow({ id: 1, name: 'Lebensmittel', pattern: 'rewe' });
    created.next(category);
    expect(openSection).toHaveBeenCalledWith(category, true);
  });
});
