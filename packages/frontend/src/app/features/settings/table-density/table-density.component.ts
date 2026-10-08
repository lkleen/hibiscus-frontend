import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import type { TableDensity } from '@hibiscus-frontend/shared/contracts/user-settings';
import { TableDensityService, TABLE_DENSITIES } from '../../../core/services/table-density.service';
import { TranslationService } from '../../../core/services/translation.service';
import type { TranslationKey } from '../../../core/models/translation.model';
import { AmountCellComponent } from '../../transactions/cells/amount-cell/amount-cell.component';
import { DataTableCellDirective } from '../../../shared/components/data-table/data-table-cell.directive';
import { DataTableComponent } from '../../../shared/components/data-table/data-table.component';
import type {
  DataTableColDef,
  DataTableOptions,
} from '../../../shared/components/data-table/data-table.model';

interface DemoRow {
  id: number;
  date: string;
  payeeKey: TranslationKey;
  purposeKey: TranslationKey;
  amount: number;
  balance: number;
}

interface DensityOption {
  id: TableDensity;
  nameKey: TranslationKey;
  descriptionKey: TranslationKey;
}

/** Static sample data; only the texts are translated. */
const DEMO_ROWS: readonly DemoRow[] = [
  {
    id: 1,
    date: '2026-09-28',
    payeeKey: 'settings.tableDensity.demo.payee1',
    purposeKey: 'settings.tableDensity.demo.purpose1',
    amount: 2850,
    balance: 4312.4,
  },
  {
    id: 2,
    date: '2026-09-29',
    payeeKey: 'settings.tableDensity.demo.payee2',
    purposeKey: 'settings.tableDensity.demo.purpose2',
    amount: -940,
    balance: 3372.4,
  },
  {
    id: 3,
    date: '2026-09-30',
    payeeKey: 'settings.tableDensity.demo.payee3',
    purposeKey: 'settings.tableDensity.demo.purpose3',
    amount: -64.9,
    balance: 3307.5,
  },
  {
    id: 4,
    date: '2026-10-01',
    payeeKey: 'settings.tableDensity.demo.payee4',
    purposeKey: 'settings.tableDensity.demo.purpose4',
    amount: -12.99,
    balance: 3294.51,
  },
  {
    id: 5,
    date: '2026-10-02',
    payeeKey: 'settings.tableDensity.demo.payee5',
    purposeKey: 'settings.tableDensity.demo.purpose5',
    amount: -87.35,
    balance: 3207.16,
  },
  {
    id: 6,
    date: '2026-10-05',
    payeeKey: 'settings.tableDensity.demo.payee6',
    purposeKey: 'settings.tableDensity.demo.purpose6',
    amount: 120,
    balance: 3327.16,
  },
];

/**
 * Settings tab "Table density": a picker for the saved density next to a demo table that shows it.
 * The service puts the density class on `<html>`, so the demo table needs no wiring of its own.
 */
@Component({
  selector: 'app-table-density',
  templateUrl: './table-density.component.html',
  styleUrl: './table-density.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DataTableComponent, DataTableCellDirective, AmountCellComponent],
})
export class TableDensityComponent {
  protected readonly i18n = inject(TranslationService);
  protected readonly service = inject(TableDensityService);

  protected readonly options: readonly DensityOption[] = TABLE_DENSITIES.map(
    (id: TableDensity): DensityOption => ({
      id,
      nameKey: `settings.tableDensity.preset.${id}`,
      descriptionKey: `settings.tableDensity.description.${id}`,
    }),
  );

  protected readonly rows: readonly DemoRow[] = DEMO_ROWS;

  protected readonly columns: readonly DataTableColDef<DemoRow>[] = [
    { colId: 'date', headerKey: 'settings.tableDensity.demo.colDate', filter: false },
    {
      colId: 'payee',
      headerKey: 'settings.tableDensity.demo.colPayee',
      valueGetter: (row: DemoRow): string => this.i18n.t(row.payeeKey),
      filter: false,
    },
    {
      colId: 'purpose',
      headerKey: 'settings.tableDensity.demo.colPurpose',
      valueGetter: (row: DemoRow): string => this.i18n.t(row.purposeKey),
      filter: false,
    },
    {
      colId: 'amount',
      headerKey: 'settings.tableDensity.demo.colAmount',
      cellRenderer: 'amount',
      align: 'end',
      filter: false,
    },
    {
      colId: 'balance',
      headerKey: 'settings.tableDensity.demo.colBalance',
      cellRenderer: 'amount',
      align: 'end',
      filter: false,
    },
  ];

  protected readonly tableOptions: DataTableOptions<DemoRow> = {
    getRowId: (row: DemoRow): number => row.id,
    quickFilter: false,
    pagination: false,
    scrollHeight: false,
    columnResize: false,
    columnReorder: false,
    autoSizeStrategy: { type: 'fitGridWidth' },
    emptyKey: 'settings.tableDensity.demo.empty',
  };

  protected select(density: TableDensity): void {
    if (this.service.saving()) return;
    this.service.save(density);
  }

  protected asAmount(value: unknown): number | null {
    if (value === null || typeof value === 'number') return value;
    throw new Error(`amount cell expects number | null, got ${typeof value}`);
  }
}
