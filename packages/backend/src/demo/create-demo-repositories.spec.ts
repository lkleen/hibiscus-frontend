import { describe, expect, it } from 'vitest';
import type { TransactionsResponse } from '@hibiscus-frontend/shared/contracts/transactions';
import { createDemoRepositories } from './create-demo-repositories';
import type { DemoRepositories } from './create-demo-repositories';
import type { DemoDataset } from './demo-dataset';
import { createTestDataset } from './demo-test-dataset.fixture';

describe('createDemoRepositories', () => {
  it('builds every repository on one store and leaves the dataset unchanged', async () => {
    const dataset: DemoDataset = createTestDataset();
    const before: string = JSON.stringify(dataset);
    const demo: DemoRepositories = createDemoRepositories(dataset);
    await demo.repositories.transactions.update(2, {
      expected: { kommentar: null, umsatztyp_id: null },
      next: { kommentar: 'neu', umsatztyp_id: 1 },
    });
    const response: TransactionsResponse = await demo.repositories.transactions.list();
    expect(response.rows).toHaveLength(3);
    expect(demo.store.transactions.get(2)?.kommentar).toBe('neu');
    expect(JSON.stringify(dataset)).toBe(before);
    expect(Object.keys(demo.repositories).sort()).toEqual([
      'accounts',
      'appUsers',
      'bankConnections',
      'categories',
      'syncRuns',
      'taxSections',
      'taxTags',
      'transactions',
      'userSettings',
    ]);
  });
});
