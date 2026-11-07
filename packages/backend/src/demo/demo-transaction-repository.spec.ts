import { beforeEach, describe, expect, it } from 'vitest';
import type {
  TransactionEditableFields,
  TransactionsResponse,
  TransactionUpdateRequest,
  TransactionValue,
} from '@hibiscus-frontend/shared/contracts/transactions';
import { MissingReferenceError } from '../repositories/repository-errors';
import { TRANSACTION_COLUMNS } from '../repositories/umsatz';
import type { TransactionAssignResult, TransactionUpdateResult } from '../repositories/umsatz';
import type { DemoDataset } from './demo-dataset';
import { createDemoStore } from './demo-store';
import type { DemoStore } from './demo-store';
import { createTestDataset } from './demo-test-dataset.fixture';
import { DemoTransactionRepository } from './demo-transaction-repository';

describe('DemoTransactionRepository', () => {
  let dataset: DemoDataset;
  let store: DemoStore;
  let repository: DemoTransactionRepository;

  beforeEach(() => {
    dataset = createTestDataset();
    store = createDemoStore(dataset);
    repository = new DemoTransactionRepository(store);
  });

  it('lists the rows as values in TRANSACTION_COLUMNS order, ordered by id', async () => {
    const response: TransactionsResponse = await repository.list();
    expect(response.columns).toEqual(TRANSACTION_COLUMNS);
    expect(response.rows.map((row: TransactionValue[]) => row[0])).toEqual([1, 2, 3]);
    const first: Record<string, unknown> = Object.fromEntries(
      response.columns.map((column: string, index: number) => [column, response.rows[0][index]]),
    );
    expect(first).toEqual(store.transactions.get(1));
    expect(first['datum']).toBe('2026-11-01');
  });

  it('updates a row that still holds expected and leaves the dataset alone', async () => {
    const result: TransactionUpdateResult = await repository.update(1, {
      expected: { kommentar: null, umsatztyp_id: 2 },
      next: { kommentar: 'Notiz', umsatztyp_id: 3 },
    });
    expect(result).toBe('updated');
    expect(store.transactions.get(1)).toMatchObject({ kommentar: 'Notiz', umsatztyp_id: 3 });
    expect(dataset.transactions[1]).toMatchObject({ id: 1, kommentar: null, umsatztyp_id: 2 });
  });

  it('counts a no-op update as updated', async () => {
    const unchanged: TransactionEditableFields = { kommentar: null, umsatztyp_id: 2 };
    expect(await repository.update(1, { expected: unchanged, next: unchanged })).toBe('updated');
  });

  it('answers conflict for a stale expected and not-found for a missing row', async () => {
    const stale: TransactionUpdateRequest = {
      expected: { kommentar: 'alt', umsatztyp_id: 2 },
      next: { kommentar: null, umsatztyp_id: null },
    };
    expect(await repository.update(1, stale)).toBe('conflict');
    expect(store.transactions.get(1)?.umsatztyp_id).toBe(2);
    expect(await repository.update(99, stale)).toBe('not-found');
  });

  it('throws MissingReferenceError for an unknown category', async () => {
    await expect(
      repository.update(2, {
        expected: { kommentar: null, umsatztyp_id: null },
        next: { kommentar: null, umsatztyp_id: 42 },
      }),
    ).rejects.toEqual(new MissingReferenceError('category'));
  });

  it('assigns a category to every row', async () => {
    const result: TransactionAssignResult = await repository.assignCategory({
      umsatztyp_id: 3,
      items: [
        { id: 3, expected: { kommentar: null, umsatztyp_id: null } },
        { id: 1, expected: { kommentar: null, umsatztyp_id: 2 } },
      ],
    });
    expect(result).toEqual({ result: 'assigned' });
    expect(store.transactions.get(1)?.umsatztyp_id).toBe(3);
    expect(store.transactions.get(3)?.umsatztyp_id).toBe(3);
  });

  it('assigns nothing when any row conflicts and reports every conflict in id order', async () => {
    const result: TransactionAssignResult = await repository.assignCategory({
      umsatztyp_id: 3,
      items: [
        { id: 99, expected: { kommentar: null, umsatztyp_id: null } },
        { id: 2, expected: { kommentar: null, umsatztyp_id: null } },
        { id: 1, expected: { kommentar: null, umsatztyp_id: null } },
      ],
    });
    expect(result).toEqual({ result: 'conflict', conflictIds: [1, 99] });
    expect(store.transactions.get(2)?.umsatztyp_id).toBeNull();
  });

  it('assigns nothing and throws for an unknown category', async () => {
    await expect(
      repository.assignCategory({
        umsatztyp_id: 42,
        items: [{ id: 2, expected: { kommentar: null, umsatztyp_id: null } }],
      }),
    ).rejects.toBeInstanceOf(MissingReferenceError);
    expect(store.transactions.get(2)?.umsatztyp_id).toBeNull();
  });
});
