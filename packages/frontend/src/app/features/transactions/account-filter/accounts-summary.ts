import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import { TranslationService } from '../../../core/services/translation.service';
import { accountLabel } from '../../../core/utils/account-label';

export interface AccountsSummaryParams {
  readonly accounts: readonly AccountRow[];
  readonly excludedIds: ReadonlySet<number>;
  readonly i18n: TranslationService;
}

/**
 * One line for the account selection: "All accounts", "No accounts", the single account's label or
 * "n of m accounts". Shared by the account filter's trigger and the ribbon tab's state text.
 */
export function accountsSummary(params: AccountsSummaryParams): string {
  const checked: readonly AccountRow[] = params.accounts.filter(
    (account: AccountRow): boolean => !params.excludedIds.has(account.id),
  );
  if (checked.length === params.accounts.length) return params.i18n.t('accountFilter.all');
  if (checked.length === 0) return params.i18n.t('accountFilter.none');
  if (checked.length === 1) return accountLabel(checked[0]);
  return params.i18n.t('accountFilter.some', {
    count: checked.length,
    total: params.accounts.length,
  });
}
