import { Dialog, DialogRef } from '@angular/cdk/dialog';
import { DestroyRef, Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import type {
  CategoryEditableFields,
  CategoryRow,
} from '@hibiscus-frontend/shared/contracts/categories';
import {
  APP_DIALOG_BACKDROP_CLASS,
  APP_DIALOG_PANEL_CLASS,
  APP_DIALOG_PANEL_WIDE_CLASS,
} from '../../shared/dialog/dialog-classes';
import {
  CATEGORY_EDIT_NAME_ID,
  CATEGORY_EDIT_TITLE_ID,
  CategoryEditDialogComponent,
} from './edit-dialog/category-edit-dialog.component';
import type {
  CategoryEditDialogData,
  CategoryEditSource,
} from './edit-dialog/category-edit-dialog.model';

/**
 * Opens the category dialog to create or edit a category. Provided by the page that owns the
 * {@link CategoryEditSource}, so the dialog closes with the page and at most one is open.
 */
@Injectable()
export class CategoryDialogs {
  private readonly dialog = inject(Dialog);
  private ref: DialogRef<CategoryRow> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy((): void => this.ref?.close());
  }

  /**
   * A new category, prefilled with `initial` (nothing is stored until Create). Emits once when the
   * dialog closes: the created category as stored, or `undefined` when nothing was created.
   */
  openCreate(
    source: CategoryEditSource,
    initial: CategoryEditableFields,
  ): Observable<CategoryRow | undefined> {
    return this.open({ mode: 'create', initial, source });
  }

  openEdit(source: CategoryEditSource, category: CategoryRow): void {
    this.open({ mode: 'edit', category, source });
  }

  private open(data: CategoryEditDialogData): Observable<CategoryRow | undefined> {
    this.ref?.close();
    const ref: DialogRef<CategoryRow> = this.dialog.open<CategoryRow, CategoryEditDialogData>(
      CategoryEditDialogComponent,
      {
        data,
        ariaLabelledBy: CATEGORY_EDIT_TITLE_ID,
        panelClass: [APP_DIALOG_PANEL_CLASS, APP_DIALOG_PANEL_WIDE_CLASS],
        backdropClass: APP_DIALOG_BACKDROP_CLASS,
        autoFocus: `#${CATEGORY_EDIT_NAME_ID}`,
      },
    );
    this.ref = ref;
    ref.closed.subscribe((): void => {
      if (this.ref === ref) this.ref = null;
    });
    return ref.closed;
  }
}
