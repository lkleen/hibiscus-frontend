import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';

/** The tax-section dialog for one category. */
export interface TaxTagSectionDialogData {
  readonly category: CategoryRow;
  /** Opened right after the category was created: the dialog offers "Skip" instead of "Cancel". */
  readonly afterCreate: boolean;
}
