import type {
  AccountBalanceResponse,
  BankAccount,
  BankingInformation,
  ClientResponse,
  FinTSClient,
  FinTSConfig,
  Mt940Parser,
  Statement,
  StatementResponse,
  Transaction,
} from 'lib-fints' with { 'resolution-mode': 'import' };
import type {
  DiscoveredAccount,
  TanChallengeKind,
  TanMethodOption,
} from '@hibiscus-frontend/shared/contracts/sync';
import type { FetchedBooking, StatementBalance } from './fetched-booking';
import type { ChallengeImage, PendingChallenge, TanPrompt } from './pending-tan-registry';

type LibFints = typeof import('lib-fints', { with: { 'resolution-mode': 'import' } });
type TanMethod = FinTSConfig['availableTanMethods'][number];

/**
 * The product version sent to the banks with the product ID: this app's major.minor (FinTS allows
 * at most 5 characters). Raise it with a release that changes how this app talks to banks.
 */
export const FINTS_PRODUCT_VERSION = '2.0';

/**
 * The FinTS product registration (Deutsche Kreditwirtschaft) sent in every bank dialog: Hibiscus's
 * official one, as hibiscus-frontend is a frontend for Hibiscus and works on its database. Taken
 * from Hibiscus's `HBCI.java` (`client.product.name`). Public, like every distributed client's
 * ID. A fork that ships as a different application registers its own and replaces it here.
 */
export const FINTS_PRODUCT_ID = 'A44C2953982351617D475443E';

/** Status poll delay for a decoupled TAN when the bank states none. */
const DEFAULT_DECOUPLED_POLL_SECONDS = 5;
/** Never poll a bank faster than this, whatever it states. */
const MIN_DECOUPLED_POLL_SECONDS = 2;

/** A bank login, with the PIN decrypted. */
export interface FintsLogin {
  readonly blz: string;
  readonly fintsUrl: string;
  readonly loginName: string;
  readonly customerId: string | null;
  readonly pin: string;
  readonly tanMethod: number | null;
  readonly tanMedia: string | null;
  /** lib-fints `BankingInformation` as JSON from an earlier dialog, `null` before the first. */
  readonly bankingInformation: string | null;
}

/** What a session needs besides the login. */
export interface FintsSessionParams {
  readonly login: FintsLogin;
  readonly prompt: TanPrompt;
  /** Persists the bank parameter data (JSON); called after every dialog. */
  readonly saveBankingInformation: (json: string) => Promise<void>;
}

/** The bank's answer to a discovery, before the accounts are matched to kontos. */
export interface FintsDiscovery {
  readonly tanMethods: TanMethodOption[];
  readonly selectedTanMethod: number;
  readonly tanMedia: string[];
  readonly accounts: Omit<DiscoveredAccount, 'kontoId'>[];
}

/** Statements of one account between two dates (inclusive). */
export interface StatementRequest {
  readonly accountIdentifier: string;
  readonly from: Date;
  readonly to: Date;
}

/**
 * One FinTS login's dialogs with its bank. Every method may ask for a TAN through the session's
 * `TanPrompt` and throws when the bank refuses the order.
 */
export interface FintsSession {
  /** Synchronizes, selecting a TAN method if none is yet, and lists TAN methods and accounts. */
  discover(): Promise<FintsDiscovery>;
  /** Booked MT940 (HKKAZ) lines of one account. */
  fetchStatements(request: StatementRequest): Promise<FetchedBooking[]>;
  /** HKSAL balance of one account, `null` when the bank does not offer it for the account. */
  fetchBalance(accountIdentifier: string): Promise<StatementBalance | null>;
}

export type FintsSessionFactory = (params: FintsSessionParams) => Promise<FintsSession>;

/** The bank refused an order; the message carries the bank's return codes and texts. */
export class BankRefusedError extends Error {
  constructor(order: string, response: ClientResponse) {
    const answers: string = response.bankAnswers
      .map((answer: { code: number; text: string }) => `${answer.code} ${answer.text}`)
      .join('; ');
    super(`The bank refused ${order}: ${answers}`);
    this.name = 'BankRefusedError';
  }
}

// --- Mapping lib-fints data -----------------------------------------------------------------

/** The account identifier the mapping stores: IBAN, else account number. */
export function accountIdentifier(account: BankAccount): string {
  return account.iban ?? account.accountNumber;
}

function parseBankingInformation(json: string): BankingInformation {
  return JSON.parse(json) as BankingInformation;
}

/**
 * TAN methods and accounts from stored bank parameter data. `tanMethod`: the chosen method, used
 * when the bank still offers it, else the bank's first. Throws when the data has no TAN method or
 * no account list (a discovery has not completed).
 */
export function describeBankingInformation(
  info: BankingInformation,
  tanMethod: number | null,
): FintsDiscovery {
  const bpd: BankingInformation['bpd'] = info.bpd;
  const accounts: BankAccount[] | undefined = info.upd?.bankAccounts;
  if (bpd === undefined || accounts === undefined) {
    throw new Error('The bank parameter data has no account list yet');
  }
  const methods: TanMethodOption[] = bpd.supportedTanMethods
    .filter((method: TanMethod) => bpd.availableTanMethodIds.includes(method.id))
    .map((method: TanMethod): TanMethodOption => ({
      id: method.id,
      name: method.name,
      decoupled: method.isDecoupled,
      media: method.activeTanMedia,
      // TanMediaRequirement.Required
      mediaRequired: method.tanMediaRequirement === 2,
    }));
  const selected: TanMethodOption | undefined =
    methods.find((method: TanMethodOption) => method.id === tanMethod) ?? methods[0];
  if (selected === undefined) throw new Error('The bank offers no TAN method for this login');
  return {
    tanMethods: methods,
    selectedTanMethod: selected.id,
    tanMedia: [...selected.media],
    accounts: accounts.map((account: BankAccount): Omit<DiscoveredAccount, 'kontoId'> => ({
      identifier: accountIdentifier(account),
      iban: account.iban ?? null,
      accountNumber: account.accountNumber,
      name: account.product ?? account.holder1 ?? null,
    })),
  };
}

/** `describeBankingInformation` for the JSON stored in `hf_bank_connection`. */
export function describeStoredBankingInformation(
  json: string,
  tanMethod: number | null,
): FintsDiscovery {
  return describeBankingInformation(parseBankingInformation(json), tanMethod);
}

/** `yyyy-MM-dd` of a lib-fints date (built from local date parts). */
export function formatLocalDate(date: Date): string {
  const month: string = String(date.getMonth() + 1).padStart(2, '0');
  const day: string = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

function emptyToNull(value: string | undefined): string | null {
  return value === undefined || value === '' ? null : value;
}

/** The raw `:86:` text and the `:61:` customer reference of one transaction. */
export interface RawTransactionInfo {
  readonly info86: string;
  readonly customerRef61: string;
}

/** The `:86:` sub-fields as hbci4java reads them. */
interface Info86Fields {
  readonly gvCode: string | null;
  readonly bookingText: string | null;
  readonly primanota: string | null;
  readonly counterpartyBlz: string | null;
  readonly counterpartyAccount: string | null;
  readonly counterpartyName: string | null;
  readonly counterpartyName2: string | null;
  readonly addKey: string | null;
  readonly purposeLines: string[];
}

const PURPOSE_TAGS: string[] = [
  '20',
  '21',
  '22',
  '23',
  '24',
  '25',
  '26',
  '27',
  '28',
  '29',
  '60',
  '61',
  '62',
  '63',
];

/**
 * Splits a raw `:86:` text: a 3-digit GV code, then sub-fields introduced by the separator (the
 * 4th character, normally `?`) and a 2-digit tag. GV code `999` or a text without separator is
 * unstructured: everything after the GV code is one purpose block.
 */
export function parseInfo86(raw: string): Info86Fields {
  const gvCode: string | null = /^\d{3}/.test(raw) ? raw.slice(0, 3) : null;
  const rest: string = gvCode === null ? raw : raw.slice(3);
  const separator: string = rest.charAt(0);
  const unstructured: Info86Fields = {
    gvCode,
    bookingText: null,
    primanota: null,
    counterpartyBlz: null,
    counterpartyAccount: null,
    counterpartyName: null,
    counterpartyName2: null,
    addKey: null,
    purposeLines: rest === '' ? [] : [rest],
  };
  if (gvCode === null || gvCode === '999' || separator === '' || /[\dA-Za-z ]/.test(separator)) {
    return unstructured;
  }
  const fields: Map<string, string> = new Map<string, string>();
  const purposeLines: string[] = [];
  for (const part of rest.slice(1).split(separator)) {
    const tag: string = part.slice(0, 2);
    const value: string = part.slice(2);
    if (PURPOSE_TAGS.includes(tag)) {
      if (value !== '') purposeLines.push(value);
    } else {
      fields.set(tag, value);
    }
  }
  const field = (tag: string): string | null => emptyToNull(fields.get(tag));
  return {
    gvCode,
    bookingText: field('00'),
    primanota: field('10'),
    counterpartyBlz: field('30'),
    counterpartyAccount: field('31'),
    counterpartyName: field('32'),
    counterpartyName2: field('33'),
    addKey: field('34'),
    purposeLines,
  };
}

/** Looks up the raw `:86:` data captured while lib-fints parsed a transaction. */
export type RawInfoLookup = (transaction: Transaction) => RawTransactionInfo | undefined;

/**
 * Booked lines of the MT940 statements as `FetchedBooking`s, with the running balance after each
 * line. A statement without an opening balance (`:60M:`, which lib-fints does not read) continues
 * from the previous statement's end, or is derived back from its closing balance; throws when
 * neither exists.
 */
export function toFetchedBookings(
  statements: Statement[],
  rawInfo: RawInfoLookup,
): FetchedBooking[] {
  const bookings: FetchedBooking[] = [];
  let carried: number | undefined;
  for (const statement of statements) {
    const sum: number = statement.transactions.reduce(
      (total: number, transaction: Transaction) => total + transaction.amount,
      0,
    );
    let running: number | undefined =
      (statement.openingBalance as Statement['openingBalance'] | undefined)?.value ?? carried;
    const closing: number | undefined = (
      statement.closingBalance as Statement['closingBalance'] | undefined
    )?.value;
    if (running === undefined && closing !== undefined) running = closing - sum;
    if (running === undefined) {
      throw new Error('An MT940 statement has neither an opening nor a closing balance');
    }
    for (const transaction of statement.transactions) {
      running = roundCents(running + transaction.amount);
      const raw: RawTransactionInfo | undefined = rawInfo(transaction);
      const info: Info86Fields = parseInfo86(raw?.info86 ?? '');
      bookings.push({
        bookingDate: formatLocalDate(transaction.entryDate),
        valueDate: formatLocalDate(transaction.valueDate),
        amount: transaction.amount,
        balanceAfter: running,
        bookingText: info.bookingText,
        primanota: info.primanota,
        customerRef: emptyToNull(raw?.customerRef61 ?? transaction.customerReference),
        gvCode: info.gvCode,
        addKey: info.addKey,
        counterpartyAccount: info.counterpartyAccount,
        counterpartyBlz: info.counterpartyBlz,
        counterpartyName: info.counterpartyName,
        counterpartyName2: info.counterpartyName2,
        purposeLines: info.purposeLines,
        pending: false,
      });
    }
    carried = running;
  }
  return bookings;
}

// --- Hooks into lib-fints's MT940 parser ------------------------------------------------------

/**
 * lib-fints's parsed `Transaction` is lossy for Hibiscus's checksum: it joins the `?20`–`?29`
 * purpose lines without separators, replaces the purpose with the `SVWZ+` part, joins `?32`/`?33`
 * and overwrites the `:61:` customer reference with `KREF+`. It also swallows an MT940 parse
 * error (logs it, returns no statements), which would look like "no new bookings".
 *
 * Two prototype hooks keep what the checksum needs, without forking the library:
 * - `parseInfoToAccountOwner` records the raw `:86:` text and the `:61:` customer reference per
 *   transaction object (a WeakMap, so no shared mutable state between concurrent dialogs);
 * - `parse` marks the array it returns when parsing threw, and `fetchStatements` throws on it.
 */
const rawInfoByTransaction: WeakMap<Transaction, RawTransactionInfo> = new WeakMap<
  Transaction,
  RawTransactionInfo
>();
const PARSE_FAILED: unique symbol = Symbol('mt940ParseFailed');
const HOOKED: unique symbol = Symbol('hibiscusHooks');

interface MarkedStatements extends Array<Statement> {
  [PARSE_FAILED]?: unknown;
}

type Mt940ParserPrototype = Mt940Parser & { [HOOKED]?: true };

export function installMt940Hooks(parserClass: LibFints['Mt940Parser']): void {
  const prototype: Mt940ParserPrototype = parserClass.prototype as Mt940ParserPrototype;
  if (prototype[HOOKED]) return;
  const originalInfo: Mt940Parser['parseInfoToAccountOwner'] = prototype.parseInfoToAccountOwner;
  const originalParse: Mt940Parser['parse'] = prototype.parse;
  prototype.parseInfoToAccountOwner = function (this: Mt940Parser, info: string): void {
    const transaction: Transaction | undefined = this.currentTransaction;
    if (transaction !== undefined) {
      rawInfoByTransaction.set(transaction, {
        info86: info,
        customerRef61: transaction.customerReference,
      });
    }
    originalInfo.call(this, info);
  };
  prototype.parse = function (this: Mt940Parser): Statement[] {
    try {
      return originalParse.call(this);
    } catch (error: unknown) {
      const failed: MarkedStatements = [];
      failed[PARSE_FAILED] = error;
      return failed;
    }
  };
  prototype[HOOKED] = true;
}

/** The raw `:86:` data the hooks captured for a transaction. */
export function capturedRawInfo(transaction: Transaction): RawTransactionInfo | undefined {
  return rawInfoByTransaction.get(transaction);
}

/** Throws the MT940 parse error the `parse` hook recorded on the statements, if any. */
export function assertStatementsParsed(statements: Statement[]): void {
  const marked: MarkedStatements = statements as MarkedStatements;
  if (PARSE_FAILED in marked) {
    throw new Error(`The bank's MT940 data could not be parsed: ${String(marked[PARSE_FAILED])}`);
  }
}

// --- The lib-fints session --------------------------------------------------------------------

function toChallengeImage(response: ClientResponse): ChallengeImage | null {
  const photo: ClientResponse['tanPhoto'] = response.tanPhoto;
  if (photo === undefined || !photo.mimeType.startsWith('image/') || photo.image.length === 0) {
    return null;
  }
  return { mimeType: photo.mimeType, bytes: Buffer.from(photo.image) };
}

class LibFintsSession implements FintsSession {
  constructor(
    private readonly client: FinTSClient,
    private readonly params: FintsSessionParams,
  ) {}

  async discover(): Promise<FintsDiscovery> {
    const { client } = this;
    const login: FintsLogin = this.params.login;
    await this.order('the synchronization', {
      start: () => client.synchronize(),
      continueWith: (reference: string, tan?: string) => client.synchronizeWithTan(reference, tan),
    });
    if (
      client.config.tanMethodId === undefined ||
      client.config.bankingInformation.upd === undefined
    ) {
      // Without a TAN method the bank sends no account list: select one and synchronize again.
      const chosen: FintsDiscovery = describeTanMethodsOnly(client.config, login.tanMethod);
      client.selectTanMethod(chosen.selectedTanMethod);
      if (login.tanMedia !== null && login.tanMethod === chosen.selectedTanMethod) {
        client.selectTanMedia(login.tanMedia);
      }
      await this.order('the synchronization', {
        start: () => client.synchronize(),
        continueWith: (reference: string, tan?: string) =>
          client.synchronizeWithTan(reference, tan),
      });
    }
    return describeBankingInformation(
      client.config.bankingInformation,
      client.config.tanMethodId ?? null,
    );
  }

  async fetchStatements(request: StatementRequest): Promise<FetchedBooking[]> {
    const { client } = this;
    const account: BankAccount = this.bankAccount(request.accountIdentifier);
    const response: StatementResponse = await this.order('the statements', {
      // `false`: MT940 (HKKAZ), as the desktop client fetched — CAMT would break checksums.
      start: () => client.getAccountStatements(account, request.from, request.to, false),
      continueWith: (reference: string, tan?: string) =>
        client.getAccountStatementsWithTan(reference, tan),
    });
    assertStatementsParsed(response.statements);
    return toFetchedBookings(response.statements, capturedRawInfo);
  }

  async fetchBalance(identifier: string): Promise<StatementBalance | null> {
    const { client } = this;
    const account: BankAccount = this.bankAccount(identifier);
    if (!client.canGetAccountBalance(account)) return null;
    const response: AccountBalanceResponse = await this.order('the balance', {
      start: () => client.getAccountBalance(account),
      continueWith: (reference: string, tan?: string) =>
        client.getAccountBalanceWithTan(reference, tan),
    });
    if (response.balance === undefined) {
      throw new Error(`The bank sent no balance for account ${identifier}`);
    }
    return {
      booked: response.balance.balance,
      available: response.balance.availableAmount ?? null,
    };
  }

  private bankAccount(identifier: string): BankAccount {
    const accounts: BankAccount[] = this.client.config.bankingInformation.upd?.bankAccounts ?? [];
    const matches: BankAccount[] = accounts.filter(
      (account: BankAccount) => accountIdentifier(account) === identifier,
    );
    if (matches.length !== 1) {
      throw new Error(
        `The bank reports ${matches.length} accounts for ${identifier}; run a discovery again`,
      );
    }
    return matches[0] as BankAccount;
  }

  /**
   * Runs one order, answering TAN challenges through the prompt until the bank stops asking, then
   * persists the bank parameter data and throws when the bank refused the order.
   */
  private async order<T extends ClientResponse>(name: string, calls: OrderCalls<T>): Promise<T> {
    let response: T = await calls.start();
    let polls = 0;
    while (response.requiresTan) {
      const reference: string | undefined = response.tanReference;
      if (reference === undefined)
        throw new Error(`The bank asked for a TAN for ${name} without a reference`);
      const tan: string | undefined = await this.params.prompt.request(
        this.challenge(response, { reference, polls }),
      );
      polls += 1;
      response = await calls.continueWith(reference, tan);
    }
    await this.params.prompt.settled();
    await this.params.saveBankingInformation(JSON.stringify(this.client.config.bankingInformation));
    if (!response.success) throw new BankRefusedError(name, response);
    return response;
  }

  private challenge(
    response: ClientResponse,
    state: { readonly reference: string; readonly polls: number },
  ): PendingChallenge {
    const method: TanMethod | undefined = this.client.config.selectedTanMethod;
    const image: ChallengeImage | null = toChallengeImage(response);
    const kind: TanChallengeKind =
      method?.isDecoupled === true ? 'decoupled' : image !== null ? 'phototan' : 'tan';
    let pollDelayMs: number | null = null;
    if (kind === 'decoupled') {
      const seconds: number =
        (state.polls === 0
          ? method?.decoupled?.waitingSecondsBeforeFirstStatusRequest
          : method?.decoupled?.waitingSecondsBetweenStatusRequests) ??
        DEFAULT_DECOUPLED_POLL_SECONDS;
      pollDelayMs = Math.max(seconds, MIN_DECOUPLED_POLL_SECONDS) * 1000;
    }
    return {
      kind,
      message: response.tanChallenge ?? '',
      image: kind === 'phototan' ? image : null,
      reference: state.reference,
      pollDelayMs,
    };
  }
}

interface OrderCalls<T extends ClientResponse> {
  readonly start: () => Promise<T>;
  readonly continueWith: (reference: string, tan?: string) => Promise<T>;
}

/** TAN method choice from data that has the bank parameters but maybe no account list yet. */
function describeTanMethodsOnly(config: FinTSConfig, tanMethod: number | null): FintsDiscovery {
  return describeBankingInformation(
    {
      ...config.bankingInformation,
      upd: config.bankingInformation.upd ?? { version: 0, usage: 0, bankAccounts: [] },
    },
    tanMethod,
  );
}

function createConfig(lib: LibFints, login: FintsLogin): FinTSConfig {
  const customerId: string | undefined = login.customerId ?? undefined;
  if (login.bankingInformation === null) {
    return lib.FinTSConfig.forFirstTimeUse(
      FINTS_PRODUCT_ID,
      FINTS_PRODUCT_VERSION,
      login.fintsUrl,
      login.blz,
      login.loginName,
      login.pin,
      customerId,
    );
  }
  const info: BankingInformation = parseBankingInformation(login.bankingInformation);
  const known: boolean =
    login.tanMethod !== null &&
    (info.bpd?.availableTanMethodIds.includes(login.tanMethod) ?? false);
  return lib.FinTSConfig.fromBankingInformation(
    FINTS_PRODUCT_ID,
    FINTS_PRODUCT_VERSION,
    info,
    login.loginName,
    login.pin,
    known ? (login.tanMethod ?? undefined) : undefined,
    known ? (login.tanMedia ?? undefined) : undefined,
    customerId,
  );
}

/** The production factory: real lib-fints dialogs with the registered product ID. */
export function createLibFintsSessionFactory(): FintsSessionFactory {
  return async (params: FintsSessionParams): Promise<FintsSession> => {
    // lib-fints is ESM-only and this backend is CommonJS: load it with a dynamic import.
    const lib: LibFints = await import('lib-fints');
    installMt940Hooks(lib.Mt940Parser);
    const client: FinTSClient = new lib.FinTSClient(createConfig(lib, params.login));
    return new LibFintsSession(client, params);
  };
}
