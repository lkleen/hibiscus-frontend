import type {
  BankConnection,
  BankConnectionAccount,
  BankConnectionSettings,
  DiscoveredAccount,
  TanMethodOption,
} from '@hibiscus-frontend/shared/contracts/sync';

/** Data passed to `Dialog.open`: the connection to edit, `null` for a new one. */
export interface BankConnectionDialogData {
  readonly connection: BankConnection | null;
}

export const SYNC_INTERVAL_MIN_HOURS = 1;
export const SYNC_INTERVAL_MAX_HOURS = 168;
export const SYNC_INTERVAL_DEFAULT_HOURS = 6;

/** FinTS endpoints prefilled for known BLZs while the URL field is empty. */
const KNOWN_FINTS_URLS: Readonly<Record<string, string>> = {
  '20041144': 'https://fints.comdirect.de/fints',
  '70120400': 'https://brokerage-hbci.consorsbank.de/hbci',
};

/** The prefill for `blz`, or `null` for a bank this app does not know. */
export function knownFintsUrl(blz: string): string | null {
  return KNOWN_FINTS_URLS[blz] ?? null;
}

/** The form's fields as typed. The PIN lives only here and is never prefilled. */
export interface BankConnectionDraft {
  readonly name: string;
  readonly blz: string;
  readonly fintsUrl: string;
  readonly loginName: string;
  readonly customerId: string;
  readonly pin: string;
  readonly syncIntervalHours: string;
  readonly enabled: boolean;
}

export const EMPTY_DRAFT: BankConnectionDraft = {
  name: '',
  blz: '',
  fintsUrl: '',
  loginName: '',
  customerId: '',
  pin: '',
  syncIntervalHours: String(SYNC_INTERVAL_DEFAULT_HOURS),
  enabled: true,
};

export type DraftField = keyof BankConnectionDraft;

export function draftOf(settings: BankConnectionSettings | null): BankConnectionDraft {
  if (settings === null) return EMPTY_DRAFT;
  return {
    name: settings.name,
    blz: settings.blz,
    fintsUrl: settings.fintsUrl,
    loginName: settings.loginName,
    customerId: settings.customerId ?? '',
    pin: '',
    syncIntervalHours: String(settings.syncIntervalHours),
    enabled: settings.enabled,
  };
}

/** The draft with `field` replaced; typing a known BLZ fills an empty URL. */
export function withField(
  draft: BankConnectionDraft,
  field: DraftField,
  value: string | boolean,
): BankConnectionDraft {
  const next: BankConnectionDraft = { ...draft, [field]: value };
  if (field === 'blz' && typeof value === 'string' && draft.fintsUrl.trim() === '') {
    return { ...next, fintsUrl: knownFintsUrl(value.trim()) ?? '' };
  }
  return next;
}

/** Fields that block saving. */
export type DraftProblem = 'name' | 'blz' | 'fintsUrl' | 'loginName' | 'pin' | 'interval';

/** The invalid fields; the PIN is only required for a new connection. */
export function draftProblems(draft: BankConnectionDraft, isNew: boolean): readonly DraftProblem[] {
  const problems: DraftProblem[] = [];
  if (draft.name.trim() === '') problems.push('name');
  if (!/^\d{8}$/.test(draft.blz.trim())) problems.push('blz');
  if (!/^https:\/\/\S+$/.test(draft.fintsUrl.trim())) problems.push('fintsUrl');
  if (draft.loginName.trim() === '') problems.push('loginName');
  if (isNew && draft.pin === '') problems.push('pin');
  const hours = Number(draft.syncIntervalHours);
  if (
    draft.syncIntervalHours.trim() === '' ||
    !Number.isInteger(hours) ||
    hours < SYNC_INTERVAL_MIN_HOURS ||
    hours > SYNC_INTERVAL_MAX_HOURS
  ) {
    problems.push('interval');
  }
  return problems;
}

/** The settings a valid draft stands for, with the TAN choice carried over from `kept`. */
export function settingsOf(
  draft: BankConnectionDraft,
  kept: Pick<BankConnectionSettings, 'tanMethod' | 'tanMedia'>,
): BankConnectionSettings {
  const customerId: string = draft.customerId.trim();
  return {
    name: draft.name.trim(),
    blz: draft.blz.trim(),
    fintsUrl: draft.fintsUrl.trim(),
    loginName: draft.loginName.trim(),
    customerId: customerId === '' ? null : customerId,
    tanMethod: kept.tanMethod,
    tanMedia: kept.tanMedia,
    syncIntervalHours: Number(draft.syncIntervalHours),
    enabled: draft.enabled,
  };
}

/** The editable settings of a stored connection (everything the API accepts back). */
export function settingsOfConnection(connection: BankConnection): BankConnectionSettings {
  return {
    name: connection.name,
    blz: connection.blz,
    fintsUrl: connection.fintsUrl,
    loginName: connection.loginName,
    customerId: connection.customerId,
    tanMethod: connection.tanMethod,
    tanMedia: connection.tanMedia,
    syncIntervalHours: connection.syncIntervalHours,
    enabled: connection.enabled,
  };
}

/** One discovered bank account with its mapping state. */
export interface AccountMappingRow {
  readonly identifier: string;
  readonly iban: string | null;
  readonly accountNumber: string;
  readonly name: string | null;
  /** The Hibiscus `konto.id` it is written to; `null` = not synced. */
  readonly kontoId: number | null;
  readonly enabled: boolean;
}

/**
 * One row per discovered account. A stored mapping wins; otherwise the `konto` the bank's IBAN or
 * number matched is preselected, enabled.
 */
export function mappingRowsOf(
  discovered: readonly DiscoveredAccount[],
  stored: readonly BankConnectionAccount[],
): readonly AccountMappingRow[] {
  return discovered.map((account: DiscoveredAccount): AccountMappingRow => {
    const mapped: BankConnectionAccount | undefined = stored.find(
      (entry: BankConnectionAccount) => entry.accountIdentifier === account.identifier,
    );
    return {
      identifier: account.identifier,
      iban: account.iban,
      accountNumber: account.accountNumber,
      name: account.name,
      kontoId: mapped ? mapped.kontoId : account.kontoId,
      enabled: mapped ? mapped.enabled : true,
    };
  });
}

/** The complete mapping to store: only rows with a target account. */
export function mappingOf(rows: readonly AccountMappingRow[]): readonly BankConnectionAccount[] {
  return rows.flatMap((row: AccountMappingRow): BankConnectionAccount[] =>
    row.kontoId === null
      ? []
      : [{ accountIdentifier: row.identifier, kontoId: row.kontoId, enabled: row.enabled }],
  );
}

/** The TAN medium to keep when the method changes: the current one if still offered, else the first. */
export function mediaFor(
  method: TanMethodOption | undefined,
  current: string | null,
): string | null {
  if (!method || !method.mediaRequired) return null;
  if (current !== null && method.media.includes(current)) return current;
  return method.media[0] ?? null;
}
