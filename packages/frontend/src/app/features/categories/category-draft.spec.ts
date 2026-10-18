import type { CategoryEditableFields } from '@hibiscus-frontend/shared/contracts/categories';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import { transaction } from '../transactions/testing/transaction-fixture';
import { categoryDraftFrom } from './category-draft';

describe('categoryDraftFrom', () => {
  it('takes the trimmed recipient name as name and pattern', () => {
    const row: TransactionRow = transaction({ empfaenger_name: '  Rewe Markt  ' });

    const draft: CategoryEditableFields = categoryDraftFrom(row);

    expect(draft.name).toBe('Rewe Markt');
    expect(draft.pattern).toBe('Rewe Markt');
    expect(draft.isregex).toBe(0);
  });

  it('escapes every comma in the pattern but not in the name', () => {
    const draft: CategoryEditableFields = categoryDraftFrom(
      transaction({ empfaenger_name: 'Müller, Hans, GmbH' }),
    );

    expect(draft.name).toBe('Müller, Hans, GmbH');
    expect(draft.pattern).toBe('Müller\\, Hans\\, GmbH');
  });

  it('leaves name and pattern empty when the recipient is null or blank', () => {
    for (const empfaenger_name of [null, '', '   ']) {
      const draft: CategoryEditableFields = categoryDraftFrom(transaction({ empfaenger_name }));

      expect(draft.name).toBe('');
      expect(draft.pattern).toBeNull();
    }
  });

  it('maps the sign of the amount to expense, income or any', () => {
    expect(categoryDraftFrom(transaction({ betrag: -12.5 })).umsatztyp).toBe(0);
    expect(categoryDraftFrom(transaction({ betrag: 2000 })).umsatztyp).toBe(1);
    expect(categoryDraftFrom(transaction({ betrag: 0 })).umsatztyp).toBeNull();
  });

  it('leaves every other field empty', () => {
    const draft: CategoryEditableFields = categoryDraftFrom(
      transaction({ empfaenger_name: 'Rewe', kommentar: 'weekly', konto_id: 4 }),
    );

    expect(draft).toEqual({
      name: 'Rewe',
      nummer: null,
      pattern: 'Rewe',
      isregex: 0,
      umsatztyp: 0,
      parent_id: null,
      color: null,
      customcolor: null,
      kommentar: null,
      konto_id: null,
      konto_kategorie: null,
      flags: null,
    });
  });
});
