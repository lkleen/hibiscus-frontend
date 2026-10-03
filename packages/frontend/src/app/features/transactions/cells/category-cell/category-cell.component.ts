import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import { TranslationService } from '../../../../core/services/translation.service';
import { CategoryPickerComponent } from '../../category-picker/category-picker.component';

/**
 * The row's category picker plus the inline "could not save" message for a failed update.
 *
 * Takes `transactionId`/`categoryId` rather than the row object itself: `applyCategory` on the
 * parent mutates the row's fields in place (see its comment) instead of replacing the object, so
 * a `row` input would never change identity and this OnPush component would never re-render.
 * Binding the two primitives it actually reads means the *expression* `row.umsatztyp_id` is
 * re-evaluated on every parent CD pass and the mutation flows through, which an object-identity
 * comparison would not catch.
 */
@Component({
  selector: 'app-transaction-category-cell',
  templateUrl: './category-cell.component.html',
  styleUrl: './category-cell.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CategoryPickerComponent],
})
export class CategoryCellComponent {
  protected readonly i18n = inject(TranslationService);

  readonly transactionId = input.required<number>();
  readonly categoryId = input.required<number | null>();
  readonly categories = input<CategoryRow[]>([]);
  /** Id of the transaction whose last category update failed, if any. */
  readonly failedUpdateId = input<number | null>(null);
  readonly categoryChange = output<number | null>();

  protected readonly hasUpdateError = computed<boolean>(
    () => this.failedUpdateId() === this.transactionId(),
  );

  protected onCategoryChange(categoryId: number | null): void {
    this.categoryChange.emit(categoryId);
  }
}
