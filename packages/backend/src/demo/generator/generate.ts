import type { DemoDataset } from '../demo-dataset';
import { buildAccounts } from './accounts';
import { parseDay } from './calendar';
import type { Day } from './calendar';
import { buildCategories, buildTaxTags } from './categories';
import { Ledger } from './ledger';
import type { LedgerResult } from './ledger';
import { Random } from './random';
import { tellStory } from './story';
import { STORY_START } from './timeline';

export interface GenerateParams {
  /** The last day with data, `YYYY-MM-DD`; normally the day the generator runs. */
  readonly endDate: string;
  readonly seed: number;
}

/** The demo dataset for Tobias Testmann; pure and deterministic for the same params. */
export function generateDemoDataset(params: GenerateParams): DemoDataset {
  const end: Day = parseDay(params.endDate);
  if (end < STORY_START) throw new Error(`The demo data starts in 2014, not ${params.endDate}`);
  const rng: Random = new Random(params.seed);
  const ledger: Ledger = new Ledger(end);
  tellStory({ rng, ledger });
  const result: LedgerResult = ledger.finalize(rng);
  return {
    generatedAt: params.endDate,
    accounts: buildAccounts({ cents: result.finalCents, date: params.endDate }),
    categories: buildCategories(),
    transactions: result.transactions,
    taxTags: buildTaxTags(),
  };
}
