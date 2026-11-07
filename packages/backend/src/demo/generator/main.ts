import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AccountRow } from '@hibiscus-frontend/shared/contracts/accounts';
import type { TransactionRow } from '@hibiscus-frontend/shared/contracts/transactions';
import { demoDataFilePath, encodeDemoDataset } from '../demo-dataset';
import type { DemoDataset } from '../demo-dataset';
import { generateDemoDataset } from './generate';

/** Fixed, so every build of the same day produces the same file. */
const DEMO_SEED = 20140101;

/** Today as `YYYY-MM-DD` in the local time zone of the build machine. */
function localToday(): string {
  const now: Date = new Date();
  const month: string = String(now.getMonth() + 1).padStart(2, '0');
  const day: string = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function main(): void {
  const started: number = Date.now();
  const dataset: DemoDataset = generateDemoDataset({ endDate: localToday(), seed: DEMO_SEED });
  const content: Buffer = encodeDemoDataset(dataset);
  const path: string = demoDataFilePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  const counts: string = dataset.accounts
    .map((account: AccountRow): string => {
      const rows: number = dataset.transactions.filter(
        (row: TransactionRow) => row.konto_id === account.id,
      ).length;
      return `${account.bezeichnung}: ${rows}`;
    })
    .join(', ');
  console.log(
    `Demo data up to ${dataset.generatedAt}: ${dataset.transactions.length} transactions (${counts}), ` +
      `${dataset.categories.length} categories, ${dataset.taxTags.length} tax tags, ` +
      `${(content.length / 1024).toFixed(0)} KiB in ${Date.now() - started} ms -> ${path}`,
  );
}

main();
