import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import { TranslationService } from '../../../core/services/translation.service';
import { APP_DIALOG_CLASS } from '../../../shared/dialog/dialog-classes';
import { CategoryPickerComponent } from '../../transactions/category-picker/category-picker.component';

/** The `ariaLabelledBy` target of the dialog. */
export const CATEGORY_PICK_TITLE_ID = 'tax-category-pick-title';

/** What the dialog picks from. */
export interface CategoryPickDialogData {
  readonly categories: readonly CategoryRow[];
}

/**
 * Picks an existing category ("Edit a category…" in step ②): a pick closes the dialog with the
 * category, which the step then opens in the category dialog.
 */
@Component({
  selector: 'app-tax-category-pick-dialog',
  templateUrl: './category-pick-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: APP_DIALOG_CLASS },
  imports: [CategoryPickerComponent],
})
export class CategoryPickDialogComponent {
  protected readonly i18n = inject(TranslationService);
  private readonly data: CategoryPickDialogData = inject<CategoryPickDialogData>(DIALOG_DATA);
  private readonly dialogRef: DialogRef<CategoryRow, CategoryPickDialogComponent> =
    inject<DialogRef<CategoryRow, CategoryPickDialogComponent>>(DialogRef);

  protected readonly titleId: string = CATEGORY_PICK_TITLE_ID;
  protected readonly categories: readonly CategoryRow[] = this.data.categories;
  protected readonly selectedId = signal<number | null>(null);

  protected pick(id: number): void {
    const category: CategoryRow | undefined = this.categories.find(
      (c: CategoryRow): boolean => c.id === id,
    );
    if (category === undefined) throw new Error(`category ${id} is not loaded`);
    this.dialogRef.close(category);
  }

  protected cancel(): void {
    this.dialogRef.close();
  }
}
