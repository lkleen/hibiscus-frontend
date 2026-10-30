import { Dialog, DialogRef } from '@angular/cdk/dialog';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import {
  APP_DIALOG_BACKDROP_CLASS,
  APP_DIALOG_PANEL_CLASS,
} from '../../../shared/dialog/dialog-classes';
import { TAN_DIALOG_TITLE_ID, TanDialogComponent } from './tan-dialog.component';
import type { TanDialogData } from './tan-dialog.model';

/** Opens the TAN dialog; at most one is open, a second call for the same run keeps it. */
@Injectable({ providedIn: 'root' })
export class TanDialogs {
  private readonly dialog = inject(Dialog);
  private ref: DialogRef<void> | null = null;
  private runId: number | null = null;

  /** Emits once when the dialog closes (answered, expired, or dismissed). */
  open(runId: number): Observable<void> {
    if (this.ref && this.runId === runId) return this.ref.closed.pipe(map((): void => undefined));
    this.ref?.close();
    const ref: DialogRef<void> = this.dialog.open<void, TanDialogData>(TanDialogComponent, {
      data: { runId },
      ariaLabelledBy: TAN_DIALOG_TITLE_ID,
      panelClass: APP_DIALOG_PANEL_CLASS,
      backdropClass: APP_DIALOG_BACKDROP_CLASS,
    });
    this.ref = ref;
    this.runId = runId;
    ref.closed.subscribe((): void => {
      if (this.ref === ref) {
        this.ref = null;
        this.runId = null;
      }
    });
    return ref.closed.pipe(map((): void => undefined));
  }
}
