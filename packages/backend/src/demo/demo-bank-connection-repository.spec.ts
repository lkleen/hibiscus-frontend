import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BankConnection,
  BankConnectionAccount,
  BankConnectionSettings,
} from '@hibiscus-frontend/shared/contracts/sync';
import type { BankConnectionRecord } from '../repositories/bank-connection';
import { DuplicateKeyError, MissingReferenceError } from '../repositories/repository-errors';
import type { EncryptedSecret } from '../sync/credential-crypto';
import { DemoBankConnectionRepository } from './demo-bank-connection-repository';
import { createDemoStore } from './demo-store';
import type { DemoStore } from './demo-store';
import { DemoSyncRunRepository } from './demo-sync-run-repository';
import { createTestDataset } from './demo-test-dataset.fixture';

const SETTINGS: BankConnectionSettings = {
  name: 'Testbank',
  blz: '12030000',
  fintsUrl: 'https://fints.example/',
  loginName: 'tobias',
  customerId: null,
  tanMethod: null,
  tanMedia: null,
  syncIntervalHours: 6,
  enabled: true,
};

function pin(label: string): EncryptedSecret {
  return { ciphertext: Buffer.from(label), iv: Buffer.alloc(12), tag: Buffer.alloc(16) };
}

async function record(
  repository: DemoBankConnectionRepository,
  id: number,
): Promise<BankConnectionRecord> {
  const found: BankConnectionRecord | null = await repository.getRecord(id);
  if (found === null) throw new Error(`No connection ${id}`);
  return found;
}

describe('DemoBankConnectionRepository', () => {
  let store: DemoStore;
  let repository: DemoBankConnectionRepository;

  beforeEach(() => {
    store = createDemoStore(createTestDataset());
    repository = new DemoBankConnectionRepository(store);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates connections with increasing ids and lists them by name', async () => {
    expect(
      await repository.create({ settings: { ...SETTINGS, name: 'Zbank' }, pin: pin('a') }),
    ).toBe(1);
    expect(await repository.create({ settings: SETTINGS, pin: pin('b') })).toBe(2);
    const list: BankConnection[] = await repository.list();
    expect(list.map((c: BankConnection) => c.name)).toEqual(['Testbank', 'Zbank']);
    expect(list[0]).toMatchObject({ id: 2, accounts: [], lastSyncAt: null, pausedReason: null });
    expect((await record(repository, 1)).pin?.ciphertext.toString()).toBe('a');
  });

  it('updates guarded by expected and drops the BPD when the bank identity changes', async () => {
    const id: number = await repository.create({ settings: SETTINGS, pin: pin('a') });
    await repository.saveBankingInformation(id, '{"bpd":1}');
    expect(
      await repository.update({ id, expected: SETTINGS, next: { ...SETTINGS, name: 'X' } }),
    ).toBe('updated');
    expect((await record(repository, id)).bankingInformation).toBe('{"bpd":1}');
    expect(await repository.update({ id, expected: SETTINGS, next: SETTINGS })).toBe('conflict');
    const current: BankConnectionSettings = { ...SETTINGS, name: 'X' };
    expect(
      await repository.update({
        id,
        expected: current,
        next: { ...current, blz: '10000000' },
        pin: pin('n'),
      }),
    ).toBe('updated');
    const updated: BankConnectionRecord = await record(repository, id);
    expect(updated.bankingInformation).toBeNull();
    expect(updated.pin?.ciphertext.toString()).toBe('n');
    expect(await repository.update({ id: 9, expected: SETTINGS, next: SETTINGS })).toBe(
      'not-found',
    );
  });

  it('replaces the account mapping, refusing unknown kontos and duplicates', async () => {
    const id: number = await repository.create({ settings: SETTINGS, pin: pin('a') });
    const account: BankConnectionAccount = {
      accountIdentifier: 'DE001',
      kontoId: 1,
      enabled: true,
    };
    expect(await repository.replaceAccounts(id, [account])).toBe('updated');
    await expect(repository.replaceAccounts(id, [{ ...account, kontoId: 9 }])).rejects.toEqual(
      new MissingReferenceError('konto'),
    );
    await expect(repository.replaceAccounts(id, [account, account])).rejects.toBeInstanceOf(
      DuplicateKeyError,
    );
    expect((await repository.get(id))?.accounts).toEqual([account]);
    expect(await repository.replaceAccounts(9, [])).toBe('not-found');
  });

  it('deletes a connection with its accounts and runs', async () => {
    const runs: DemoSyncRunRepository = new DemoSyncRunRepository(store);
    const keep: number = await repository.create({ settings: SETTINGS, pin: pin('a') });
    const id: number = await repository.create({ settings: SETTINGS, pin: pin('b') });
    await repository.replaceAccounts(id, [
      { accountIdentifier: 'DE001', kontoId: 1, enabled: true },
    ]);
    await runs.create(id, 'manual');
    const kept: number = await runs.create(keep, 'manual');
    expect(await repository.delete(id)).toBe(true);
    expect(await repository.delete(id)).toBe(false);
    expect(store.bankConnectionAccounts).toEqual([]);
    expect([...store.syncRuns.keys()]).toEqual([kept]);
  });

  it('lists the due connections by the interval', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 7, 12, 0, 0));
    const never: number = await repository.create({ settings: SETTINGS, pin: pin('a') });
    const recent: number = await repository.create({ settings: SETTINGS, pin: pin('b') });
    const old: number = await repository.create({ settings: SETTINGS, pin: pin('c') });
    const paused: number = await repository.create({ settings: SETTINGS, pin: pin('d') });
    await repository.setPaused(paused, 'tan');
    vi.setSystemTime(new Date(2026, 10, 7, 6, 0, 0));
    await repository.recordOutcome(old, { status: 'success', error: null });
    vi.setSystemTime(new Date(2026, 10, 7, 6, 0, 1));
    await repository.recordOutcome(recent, { status: 'error', error: 'boom' });
    vi.setSystemTime(new Date(2026, 10, 7, 12, 0, 0));
    expect(await repository.listDueIds()).toEqual([never, old]);
    expect((await repository.get(recent))?.lastSyncAt).toBe('2026-11-07 06:00:01');
  });

  it('re-encrypts every PIN when beforeCommit succeeds', async () => {
    await repository.create({ settings: SETTINGS, pin: pin('a') });
    await repository.create({ settings: SETTINGS, pin: pin('b') });
    const count: number = await repository.reencryptPins({
      reencrypt: (old: EncryptedSecret): EncryptedSecret => pin(`new-${old.ciphertext.toString()}`),
      beforeCommit: async (): Promise<void> => undefined,
    });
    expect(count).toBe(2);
    expect((await record(repository, 2)).pin?.ciphertext.toString()).toBe('new-b');
  });

  it('applies no PIN when beforeCommit throws', async () => {
    await repository.create({ settings: SETTINGS, pin: pin('a') });
    await expect(
      repository.reencryptPins({
        reencrypt: (): EncryptedSecret => pin('new'),
        beforeCommit: async (): Promise<void> => {
          throw new Error('key write failed');
        },
      }),
    ).rejects.toThrow('key write failed');
    expect((await record(repository, 1)).pin?.ciphertext.toString()).toBe('a');
  });

  it('lets other writes wait until a re-encryption has finished', async () => {
    const id: number = await repository.create({ settings: SETTINGS, pin: pin('a') });
    let commit: () => void = (): void => {
      throw new Error('beforeCommit has not started');
    };
    const reencryption: Promise<number> = repository.reencryptPins({
      reencrypt: (): EncryptedSecret => pin('new'),
      beforeCommit: (): Promise<void> =>
        new Promise<void>((resolve: () => void): void => {
          commit = resolve;
        }),
    });
    const update: Promise<unknown> = repository.update({
      id,
      expected: SETTINGS,
      next: SETTINGS,
      pin: pin('typed'),
    });
    await Promise.resolve();
    expect((await record(repository, id)).pin?.ciphertext.toString()).toBe('a');
    commit();
    await reencryption;
    await update;
    expect((await record(repository, id)).pin?.ciphertext.toString()).toBe('typed');
  });

  it('clears every PIN and disables the connections', async () => {
    await repository.create({ settings: SETTINGS, pin: pin('a') });
    expect(await repository.clearPins()).toBe(1);
    const cleared: BankConnectionRecord = await record(repository, 1);
    expect(cleared.pin).toBeNull();
    expect(cleared.settings.enabled).toBe(false);
  });

  it('lists the konto match keys by id', async () => {
    expect(await repository.listKontoMatchKeys()).toEqual([
      { id: 1, iban: 'DE00120300000000001001', kontonummer: '1001' },
      { id: 2, iban: 'DE00120300000000001002', kontonummer: '1002' },
    ]);
  });
});
