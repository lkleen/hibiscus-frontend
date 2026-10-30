import { Dialog, DialogRef } from '@angular/cdk/dialog';
import { DestroyRef, Injectable, inject } from '@angular/core';
import type { BankConnection } from '@hibiscus-frontend/shared/contracts/sync';
import { Observable } from 'rxjs';
import {
  APP_DIALOG_BACKDROP_CLASS,
  APP_DIALOG_PANEL_CLASS,
} from '../../shared/dialog/dialog-classes';
import {
  BANK_CONNECTION_DIALOG_TITLE_ID,
  BankConnectionDialogComponent,
} from './bank-connection-dialog.component';
import type { BankConnectionDialogData } from './bank-connection-dialog.model';

/** Opens the bank connection dialog. Provided by the page, so it closes with the page. */
@Injectable()
export class BankConnectionDialogs {
  private readonly dialog = inject(Dialog);
  private ref: DialogRef<BankConnection | undefined> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy((): void => this.ref?.close());
  }

  /** Emits once on close: the connection as stored, or `undefined` if none was stored. */
  open(connection: BankConnection | null): Observable<BankConnection | undefined> {
    this.ref?.close();
    const ref: DialogRef<BankConnection | undefined> = this.dialog.open<
      BankConnection | undefined,
      BankConnectionDialogData
    >(BankConnectionDialogComponent, {
      data: { connection },
      ariaLabelledBy: BANK_CONNECTION_DIALOG_TITLE_ID,
      panelClass: APP_DIALOG_PANEL_CLASS,
      backdropClass: APP_DIALOG_BACKDROP_CLASS,
    });
    this.ref = ref;
    ref.closed.subscribe((): void => {
      if (this.ref === ref) this.ref = null;
    });
    return ref.closed;
  }
}
