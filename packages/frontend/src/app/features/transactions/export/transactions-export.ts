import { Dialog, DialogRef } from '@angular/cdk/dialog';
import { DestroyRef, Injectable, Signal, computed, inject } from '@angular/core';
import type { TaxSection } from '@hibiscus-frontend/shared/contracts/tax-tags';
import type { TableViewId } from '@hibiscus-frontend/shared/contracts/user-settings';
import {
  APP_DIALOG_BACKDROP_CLASS,
  APP_DIALOG_PANEL_CLASS,
  APP_DIALOG_PANEL_WIDE_CLASS,
} from '../../../shared/dialog/dialog-classes';
import { TransactionsStore } from '../transactions.store';
import {
  EXPORT_DIALOG_TITLE_ID,
  ExportDialogComponent,
  type ExportDialogData,
} from './export-dialog/export-dialog.component';
import type { ExportDepth, ExportDocument, ExportOptions, ExportScope } from './export.model';

/** What the active transactions tab offers for export. */
export interface ExportSource {
  readonly view: TableViewId;
  /** The deepest category level for the detail-level slider; `null` for a view without levels. */
  readonly maxDepth: Signal<number> | null;
  /**
   * The tax sections the report can be limited to, `null` until they are loaded; `null` itself for
   * a view that cannot be limited.
   */
  readonly taxSections: Signal<readonly TaxSection[] | null> | null;
  /** Builds the document from the view's current state; called at preview and at export time. */
  build(options: ExportOptions): ExportDocument;
}

/**
 * `depth` within what the view offers: a level deeper than the report goes becomes its deepest
 * level ("every transaction" when the report has no categories at all).
 */
export function clampDepth(depth: ExportDepth, maxDepth: number | null): ExportDepth {
  if (depth === 'all' || maxDepth === null || depth <= maxDepth) return depth;
  return maxDepth >= 1 ? maxDepth : 'all';
}

/** The options a view starts with: a PDF of every category level, portrait unless it is the list. */
function defaultOptions(source: ExportSource): ExportOptions {
  const maxDepth: number | null = source.maxDepth?.() ?? null;
  return {
    format: 'pdf',
    depth: maxDepth === null ? 'all' : clampDepth(maxDepth, maxDepth),
    taxSections: null,
    page: {
      format: 'a4',
      orientation: source.view === 'transactions-list' ? 'landscape' : 'portrait',
      fit: 'shrink',
    },
  };
}

/**
 * Opens the export dialog for the active tab. The tab registers its {@link ExportSource} while it
 * is shown; the dialog closes when the source goes away (tab switch) or the shell is destroyed.
 * Provided in the shell next to the {@link TransactionsStore} the scope comes from. Remembers the
 * last options per view for as long as the shell lives.
 */
@Injectable()
export class TransactionsExport {
  private readonly dialog = inject(Dialog);
  private readonly store = inject(TransactionsStore);
  private readonly remembered: Map<TableViewId, ExportOptions> = new Map<
    TableViewId,
    ExportOptions
  >();
  private source: ExportSource | null = null;
  private ref: DialogRef<void> | null = null;

  /** What every export covers: period, accounts and search, as shown in the ribbon. */
  readonly scope: Signal<ExportScope> = computed((): ExportScope => {
    const search: string = this.store.search().trim();
    return {
      period: this.store.periodText(),
      accounts: this.store.accountsText(),
      search: search === '' ? null : search,
    };
  });

  constructor() {
    inject(DestroyRef).onDestroy((): void => this.ref?.close());
  }

  /** Returns the unregister function, which also closes a dialog open for this source. */
  register(source: ExportSource): () => void {
    if (this.source !== null) {
      throw new Error(`export source "${this.source.view}" is still registered`);
    }
    this.source = source;
    return (): void => {
      if (this.source !== source) return;
      this.source = null;
      this.ref?.close();
    };
  }

  open(): void {
    const source: ExportSource | null = this.source;
    if (source === null) throw new Error('no export source is registered');
    this.ref?.close();
    const initial: ExportOptions = this.remembered.get(source.view) ?? defaultOptions(source);
    const data: ExportDialogData = {
      source,
      scope: this.scope,
      range: this.store.range,
      initial: { ...initial, depth: clampDepth(initial.depth, source.maxDepth?.() ?? null) },
      remember: (options: ExportOptions): void => {
        this.remembered.set(source.view, options);
      },
    };
    const ref: DialogRef<void> = this.dialog.open<void, ExportDialogData>(ExportDialogComponent, {
      data,
      ariaLabelledBy: EXPORT_DIALOG_TITLE_ID,
      panelClass: [APP_DIALOG_PANEL_CLASS, APP_DIALOG_PANEL_WIDE_CLASS],
      backdropClass: APP_DIALOG_BACKDROP_CLASS,
      autoFocus: 'first-tabbable',
    });
    this.ref = ref;
    ref.closed.subscribe((): void => {
      if (this.ref === ref) this.ref = null;
    });
  }
}
