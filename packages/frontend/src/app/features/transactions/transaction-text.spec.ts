import { transaction } from './testing/transaction-fixture';
import { counterpartyOf, purposeOf } from './transaction-text';

describe('transaction text', () => {
  it('joins the counterparty name lines', () => {
    expect(counterpartyOf(transaction({ empfaengerName: 'ACME', empfaengerName2: 'GmbH' }))).toBe(
      'ACME GmbH',
    );
  });

  it('joins the purpose lines and skips empty ones', () => {
    expect(purposeOf(transaction({ zweck: 'Rent', zweck2: '  ', zweck3: 'September' }))).toBe(
      'Rent September',
    );
  });

  it('returns null when every part is missing or blank', () => {
    expect(counterpartyOf(transaction())).toBeNull();
    expect(purposeOf(transaction({ zweck: '', zweck2: null }))).toBeNull();
  });
});
