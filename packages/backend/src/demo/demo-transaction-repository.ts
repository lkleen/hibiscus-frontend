import type {
  TransactionAssignItem,
  TransactionAssignRequest,
  TransactionEditableFields,
  TransactionRow,
  TransactionUpdateRequest,
  TransactionsResponse,
  TransactionValue,
} from '@hibiscus-frontend/shared/contracts/transactions';
import { MissingReferenceError } from '../repositories/repository-errors';
import { TRANSACTION_COLUMNS } from '../repositories/umsatz';
import type {
  TransactionAssignResult,
  TransactionRepository,
  TransactionUpdateResult,
} from '../repositories/umsatz';
import { sameValue } from './demo-store';
import type { DemoStore } from './demo-store';

/** The guard of the MySQL `WHERE`: `kommentar <=> ? AND umsatztyp_id <=> ?`. */
function holds(row: TransactionEditableFields, expected: TransactionEditableFields): boolean {
  return (
    sameValue(row.kommentar, expected.kommentar) &&
    sameValue(row.umsatztyp_id, expected.umsatztyp_id)
  );
}

/** `umsatz` of the demo data; only `kommentar` and `umsatztyp_id` are ever written. */
export class DemoTransactionRepository implements TransactionRepository {
  constructor(private readonly store: DemoStore) {}

  async list(): Promise<TransactionsResponse> {
    const rows: TransactionValue[][] = [];
    for (const row of this.store.transactions.values()) {
      rows.push(TRANSACTION_COLUMNS.map((column: keyof TransactionRow) => row[column]));
    }
    return { columns: [...TRANSACTION_COLUMNS], rows };
  }

  /** `fk_umsatz_umsatztyp`: checked only when a row is actually written, as in MySQL. */
  private assertCategory(categoryId: number | null): void {
    if (categoryId !== null && !this.store.categories.has(categoryId)) {
      throw new MissingReferenceError('category');
    }
  }

  async update(id: number, request: TransactionUpdateRequest): Promise<TransactionUpdateResult> {
    const row: TransactionRow | undefined = this.store.transactions.get(id);
    if (row === undefined) return 'not-found';
    if (!holds(row, request.expected)) return 'conflict';
    this.assertCategory(request.next.umsatztyp_id);
    this.store.transactions.set(id, {
      ...row,
      kommentar: request.next.kommentar,
      umsatztyp_id: request.next.umsatztyp_id,
    });
    return 'updated';
  }

  /**
   * All or nothing, like the MySQL transaction: the items are checked in ascending id order against
   * the rows as the earlier items would have left them; any conflict applies nothing. An unknown
   * category throws as soon as one row matches.
   */
  async assignCategory(request: TransactionAssignRequest): Promise<TransactionAssignResult> {
    const items: TransactionAssignItem[] = [...request.items].sort(
      (a: TransactionAssignItem, b: TransactionAssignItem): number => a.id - b.id,
    );
    const pending: Map<number, TransactionRow> = new Map<number, TransactionRow>();
    const conflictIds: number[] = [];
    for (const item of items) {
      const row: TransactionRow | undefined =
        pending.get(item.id) ?? this.store.transactions.get(item.id);
      if (row === undefined || !holds(row, item.expected)) {
        conflictIds.push(item.id);
        continue;
      }
      this.assertCategory(request.umsatztyp_id);
      pending.set(item.id, { ...row, umsatztyp_id: request.umsatztyp_id });
    }
    if (conflictIds.length > 0) return { result: 'conflict', conflictIds };
    for (const [id, row] of pending) this.store.transactions.set(id, row);
    return { result: 'assigned' };
  }
}
