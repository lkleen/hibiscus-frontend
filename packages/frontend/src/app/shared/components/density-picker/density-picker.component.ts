import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { TableDensity, TableViewId } from '@hibiscus-frontend/shared/contracts/user-settings';
import type { TranslationKey } from '../../../core/models/translation.model';
import { TABLE_DENSITIES, TableDensityService } from '../../../core/services/table-density.service';
import { TranslationService } from '../../../core/services/translation.service';

/** A segmented control choosing the density of one table view; saved per user. */
@Component({
  selector: 'app-density-picker',
  templateUrl: './density-picker.component.html',
  styleUrl: './density-picker.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DensityPickerComponent {
  protected readonly i18n = inject(TranslationService);
  protected readonly densities = inject(TableDensityService);

  readonly view = input.required<TableViewId>();

  protected readonly options: readonly TableDensity[] = TABLE_DENSITIES;
  /** Native radios in one group need a shared name; unique per instance. */
  protected readonly groupName: string = `density-picker-${crypto.randomUUID()}`;
  protected readonly current = computed((): TableDensity =>
    this.densities.densityFor(this.view())(),
  );

  protected labelKey(id: TableDensity): TranslationKey {
    return `density.${id}`;
  }

  protected choose(id: TableDensity): void {
    this.densities.save(this.view(), id);
  }
}
