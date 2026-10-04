import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';

/**
 * The name an account is shown under: its own label (`bezeichnung`), else the holder (`name`) —
 * `konto.name` is the account holder, the same on every account, so it is only a fallback.
 */
export function accountLabel(account: Pick<AccountRow, 'bezeichnung' | 'name'>): string {
  return account.bezeichnung ?? account.name;
}
