import { Dialog, DialogRef } from '@angular/cdk/dialog';
import { DestroyRef, Injectable, inject } from '@angular/core';
import {
  APP_DIALOG_BACKDROP_CLASS,
  APP_DIALOG_PANEL_CLASS,
} from '../../../shared/dialog/dialog-classes';
import {
  TAX_SECTION_DIALOG_TITLE_ID,
  TaxSectionDialogComponent,
} from './tax-section-dialog.component';

/**
 * Opens the tax sections dialog. Provided by the page that offers it, so the dialog closes with
 * the page and at most one is open.
 */
@Injectable()
export class TaxSectionDialogs {
  private readonly dialog = inject(Dialog);
  private ref: DialogRef<void> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy((): void => this.ref?.close());
  }

  /** A second call while the dialog is open keeps it, with any unsaved changes. */
  open(): void {
    if (this.ref) return;
    const ref: DialogRef<void> = this.dialog.open<void>(TaxSectionDialogComponent, {
      ariaLabelledBy: TAX_SECTION_DIALOG_TITLE_ID,
      panelClass: APP_DIALOG_PANEL_CLASS,
      backdropClass: APP_DIALOG_BACKDROP_CLASS,
    });
    this.ref = ref;
    ref.closed.subscribe((): void => {
      if (this.ref === ref) this.ref = null;
    });
  }
}
