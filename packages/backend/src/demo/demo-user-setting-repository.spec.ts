import { describe, expect, it } from 'vitest';
import { createDemoStore } from './demo-store';
import { createTestDataset } from './demo-test-dataset.fixture';
import { DemoUserSettingRepository } from './demo-user-setting-repository';

describe('DemoUserSettingRepository', () => {
  it('stores values per user as JSON', async () => {
    const repository: DemoUserSettingRepository = new DemoUserSettingRepository(
      createDemoStore(createTestDataset()),
    );
    expect(await repository.get('anna', 'grid')).toBeUndefined();
    await repository.put({ user: 'anna', key: 'grid', value: { columns: ['a'] } });
    await repository.put({ user: 'anna', key: 'grid', value: null });
    expect(await repository.get('anna', 'grid')).toBeNull();
    expect(await repository.get('bert', 'grid')).toBeUndefined();
    await expect(repository.put({ user: 'anna', key: 'x', value: undefined })).rejects.toThrow();
    await repository.delete('anna', 'grid');
    expect(await repository.get('anna', 'grid')).toBeUndefined();
  });
});
