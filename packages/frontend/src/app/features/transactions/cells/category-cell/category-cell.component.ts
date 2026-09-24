import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslationService } from '../../../../core/services/translation.service';
import { CategoryPickerComponent } from '../../category-picker/category-picker.component';
import { TransactionCell } from '../transaction-cell';

/** The row's category picker plus the inline "could not save" message for a failed update. */
@Component({
  selector: 'app-transaction-category-cell',
  templateUrl: './category-cell.component.html',
  styleUrl: './category-cell.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CategoryPickerComponent],
})
export class CategoryCellComponent extends TransactionCell {
  protected readonly i18n = inject(TranslationService);

  protected readonly hasUpdateError = computed<boolean>(
    () => this.context().categoryUpdateErrorId() === this.row().id,
  );

  protected onCategoryChange(categoryId: number | null): void {
    this.context().changeCategory(this.row().id, categoryId);
  }
}
