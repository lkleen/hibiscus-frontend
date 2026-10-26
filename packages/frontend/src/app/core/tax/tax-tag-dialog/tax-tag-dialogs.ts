import { Dialog, DialogRef } from '@angular/cdk/dialog';
import { DestroyRef, Injectable, inject } from '@angular/core';
import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';
import { Observable } from 'rxjs';
import {
  APP_DIALOG_BACKDROP_CLASS,
  APP_DIALOG_PANEL_CLASS,
  APP_DIALOG_PANEL_WIDE_CLASS,
} from '../../../shared/dialog/dialog-classes';
import type { TaxTagSectionDialogData } from './tax-tag-dialog.model';
import {
  TAX_TAG_SECTION_TITLE_ID,
  TaxTagSectionDialogComponent,
} from './tax-tag-section-dialog.component';

/**
 * Opens the tax-section dialog for one category. Provided by the page that uses it, so the dialog
 * closes with the page and at most one is open. `openSection` emits once when the dialog closes:
 * `true` when a tag was saved.
 */
@Injectable()
export class TaxTagDialogs {
  private readonly dialog = inject(Dialog);
  private ref: DialogRef<boolean> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy((): void => this.ref?.close());
  }

  /** `afterCreate`: the category was just created; the dialog can be skipped. */
  openSection(category: CategoryRow, afterCreate = false): Observable<boolean> {
    this.ref?.close();
    const data: TaxTagSectionDialogData = { category, afterCreate };
    const ref: DialogRef<boolean> = this.dialog.open<boolean, TaxTagSectionDialogData>(
      TaxTagSectionDialogComponent,
      {
        data,
        ariaLabelledBy: TAX_TAG_SECTION_TITLE_ID,
        panelClass: [APP_DIALOG_PANEL_CLASS, APP_DIALOG_PANEL_WIDE_CLASS],
        backdropClass: APP_DIALOG_BACKDROP_CLASS,
      },
    );
    this.ref = ref;
    return new Observable<boolean>((subscriber) => {
      const sub = ref.closed.subscribe((saved: boolean | undefined): void => {
        if (this.ref === ref) this.ref = null;
        subscriber.next(saved === true);
        subscriber.complete();
      });
      return (): void => sub.unsubscribe();
    });
  }
}
