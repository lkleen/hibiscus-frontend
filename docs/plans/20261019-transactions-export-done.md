# Export for the transaction views (by category + list)

**Plan status:** done

## Context

Users want to take the transaction views out of the app, above all the **by-category report**
(Hibiscus "Umsätze nach Kategorien"), for tax, budgeting or sharing. The ribbon plan
(`20261018-ribbon-toolbar-done.md`) already reserved an **Export** tab for this. An Export button
opens a dialog where the export is configured; the file is generated client-side and downloaded.

Decisions (user, 2026-10-19):

- **Formats:** CSV, PDF, JSON. (No XLSX.) PDF adds **`jspdf` + `jspdf-autotable`** (MIT),
  lazy-loaded via dynamic `import()` only when a PDF is generated.
- **PDF must always fit the page.** Paper format (default A4), orientation and the fit mode
  (fit to width / wrap text / split columns across pages) are configurable in the dialog.
- **Detail levels (by category):** a **depth slider**: category levels 1…N (N = deepest level in
  the current report) plus a last step "every transaction". Every category row carries its sum,
  income and expenses (sums always over *all* descendants, regardless of depth). Plus a grand
  total row.
- **List view:** transactions only (no aggregation), with the table's visible columns in their
  current order and the current sort.
- **Scope:** exactly what is shown — the selected time range **and** every other active filter
  (excluded accounts, search, column filters in the list view). The dialog states the scope
  (period, accounts, search) so nothing is hidden.

All data is already client-side (`TransactionsStore` loads everything once); no backend or shared
contract changes.

## Design

### Data-table: read-only export snapshot (`shared/components/data-table/`)

Per CLAUDE.md, table features live in `<app-data-table>`. Add one public method,
`exportSnapshot(): DataTableExportSnapshot<Row>` =
`{ columns: visible columns in user order (no hidden), rows: displayRows() (filtered + sorted),
cell(column, row): { raw, formatted } }` reusing the private `displayRows`, `visibleColumns` and
`cellView`. Type in `data-table.model.ts`. Spec: filtered/sorted rows and reordered columns come out
as displayed.

### Export core (`features/transactions/export/`, pure, no Angular)

- `export.model.ts`
  - `ExportFormat = 'csv' | 'pdf' | 'json'`
  - `ExportCell = string | number | null`; `ExportColumn = { id, header, kind: 'text' | 'amount' }`
  - `ExportRow = { kind: 'category' | 'transaction' | 'total'; level: number; cells: ExportCell[] }`
    (level 0 = top; drives indentation in CSV/PDF and nesting in JSON)
  - `ExportDocument = { title, scope: ExportScope, columns, rows }`;
    `ExportScope = { period: string; accounts: string; search: string | null }`
  - `ExportOptions = { format; depth: number | 'all' }` (`depth` ignored by the list view)
- `export-writers.ts`
  - `toCsv(doc, locale)`: UTF-8 BOM; `de` → `;` separator and decimal comma, `en` → `,` and `.`;
    amounts unformatted (no thousands separators) so spreadsheets parse them; RFC 4180 quoting.
    Category rows: first column indented by level (`"  "` × level) **and** a `level` column so
    the hierarchy survives sorting in a spreadsheet. Scope lines are *not* written into CSV
    (keeps it machine-readable); they go into the filename.
  - `toJson(doc)`: `{ title, scope, exportedAt, columns, rows }` with rows nested by `level`
    (`children`), raw numbers.
  - `toPdf(doc, { locale, page }): Promise<Blob>`: `await import('jspdf')` + `jspdf-autotable`;
    title + scope header; category rows bold and indented by level; amounts right-aligned,
    formatted with `Intl.NumberFormat(locale, {minimumFractionDigits: 2, maximumFractionDigits:
    2})`, never wrapped; total row bold; header row repeated on every page; "page x / y" footer.
  - **PDF page setup** `PdfPageSetup = { format: 'a4' | 'a3' | 'a5' | 'letter' | 'legal';
    orientation: 'portrait' | 'landscape'; fit: PdfFit }` (default `a4`; orientation defaults
    to portrait for by-category, landscape for the list; user can change both). The table
    **always stays inside the printable area** (page minus margins); `fit` decides how:
    - `'shrink'` (**default**) — *fit to page width*: measure each column's natural width at
      the base font size (jsPDF `getTextWidth`), scale the font size (and padding) down by
      `available / natural`, never below a 6 pt floor; if it still does not fit at the floor,
      text columns (purpose, name, recipient) wrap (`overflow: 'linebreak'`) while amount and
      date columns keep their width.
    - `'wrap'` — keep the base font size; amount/date columns get their natural width, the
      remaining width is shared by the text columns, which wrap.
    - `'split'` — keep the base font size, no wrapping; columns that do not fit continue on
      following pages (`horizontalPageBreak`, repeating the first column — the category /
      name — on every page).
    The width computation is a pure function `planPdfLayout(doc, page, measure)` (measure
    injected), so it is unit-tested without jsPDF: for every format × orientation × fit, the
    sum of column widths ≤ printable width (shrink/wrap) and each split page ≤ printable width.
- `export-file.ts`: `exportFileName(view, range, format)` →
  `transactions-by-category_2026-01-01_2026-09-30.pdf` (`all-dates` when the range is open), and
  `downloadBlob(blob, name)` (object URL + temporary `<a download>`, URL revoked after click).
- `category-export.ts`: `buildCategoryExport({ rows, columns, depth, labels })` → `ExportDocument`.
  **Reuses the table's own tree code** (`toTreeNodes`, `sortTreeNodes`, `computeTreeAggregates`
  from `data-table-tree.ts`) with the by-category component's `columns`, `getParentId` and
  `compareReportRows` (exported from the component file or moved next to `buildCategoryReport` in
  `category-report.ts`), so sums and order match the screen by construction. Walk pre-order;
  emit category rows with `level < depth`, transactions only for `depth === 'all'`. Columns:
  name, (date, purpose, account for transactions), amount, income, expenses. Also
  `maxCategoryDepth(rows)` for the slider. Unassigned node behaves like a top-level category.
- `list-export.ts`: `buildListExport(snapshot, labels)` → `ExportDocument` from
  `DataTableExportSnapshot<TransactionRow>`; `betrag`/`saldo` as amount cells (raw numbers),
  everything else as the column's formatted text.

Specs for every file (CSV separators/quoting/BOM per locale, JSON nesting, depth cut-offs,
sums over hidden descendants, grand total, filename with open range). PDF spec mocks the dynamic
imports and asserts the autotable body.

### Wiring (`features/transactions/`)

- `export/transactions-export.ts` — `@Injectable() TransactionsExport`, provided in the shell
  next to `TransactionsStore`/`RibbonHost`. The active tab registers an `ExportSource`
  (`{ view: TableViewId; maxDepth: Signal<number> | null; build(options): ExportDocument }`),
  `register()` returns an unregister function (same pattern as `RibbonHost.register`). `open()`
  opens the dialog for the current source; throws if none is registered.
  - `TransactionsByCategoryComponent` registers a source built from `rows()` + `columns`.
  - `TransactionsListComponent` registers a source that reads `viewChild.required(DataTableComponent)
    .exportSnapshot()` at build time.
- Shell `transactions.component.html`: new band `appRibbonBand="export"`
  (`ribbon.tab.export`, order 3) with group `ribbon.group.export` holding an "Export…" button
  (`filters__action` styles) that calls `export.open()`.
- `export/export-dialog/export-dialog.component.*` — CDK `Dialog`, same shape as
  `assign-dialog` (`DIALOG_DATA`, `DialogRef`, `APP_DIALOG_CLASS`, `_dialog.scss` classes,
  title id constant, opened with `APP_DIALOG_PANEL_CLASS` + `APP_DIALOG_BACKDROP_CLASS`). Contents
  (final layout from Phase A mockup):
  - Scope summary: period (`periodText` from the shell, moved into the store as a computed so the
    dialog and band share it), accounts summary, search text.
  - Format: radio group CSV / PDF / JSON.
  - PDF page setup (shown only for PDF): paper format select (A4 default, A3, A5, Letter,
    Legal), orientation toggle (portrait / landscape, with a small page-shape icon), fit
    options "Fit to page width" (default) / "Wrap text" / "Split columns across pages", each
    with a one-line hint. A hint warns when "Fit to page width" would hit the 6 pt floor
    (computed with `planPdfLayout` and a canvas-based text measure) and suggests landscape or a
    larger format.
  - Detail level (by-category only): range slider 1…N + "every transaction", with a label per
    step ("Top-level categories", "2 levels", …, "Every transaction") and a live row count.
  - Filename preview; "Export" (busy + disabled while a PDF is generated) and "Cancel".
  - Builds the document **at click time** from the source (no stale snapshot); closes after the
    download starts; errors propagate (no swallowing), shown via the global handler.
  - Last chosen format/depth/page setup remembered for the session in the `TransactionsExport` service.
- i18n: `ribbon.tab.export`, `ribbon.group.export`, `transactions.export.*` (title, format
  labels, detail labels, scope labels, column headers for the level column, total, PDF title,
  buttons) in **both** `en.json` and `de.json`.
- `.claude/skills/transactions-table/SKILL.md`: short note that exports reuse the view's
  columns/tree code and never re-derive column values (project-local skill, so edit allowed).

### Race conditions

- The document is built synchronously from current signals when Export is clicked; the PDF
  dynamic import is the only async step and uses the already-built document, so a reload
  (`revision` bump) during generation cannot mix states.
- Double clicks: the Export button is disabled while busy.
- Tab switch while the dialog is open: the shell closes the dialog when the source unregisters.

## Phases

### Phase A — Dialog + ribbon mockups
- **Status:** done
- **Started:** 2026-10-19 21:38
- **Ended:** 2026-10-19 21:45

Invoke `frontend-design:frontend-design`; build 2–3 clickable HTML mockups of the export dialog
(and the Export band) in the current themes; user picks one. Blocks Phase E's dialog layout only.

**Result:** user chose **E2 — settings + live preview** (artifact `MAN1JqjPZUTYyL66d4qeRm`). The PDF preview is the real generated PDF (debounced, in an `<iframe>` from a blob URL), CSV/JSON show the first lines of the real file. `toPdf` also returns its `PdfLayout` so the dialog can warn on `hitsFloor`.

Dependencies added in C: `jspdf` 4.2.1, `jspdf-autotable` 5.0.8 (lazy).

### Phase B — Data-table export snapshot
- **Status:** done
- **Started:** 2026-10-19 21:38
- **Ended:** 2026-10-19 21:41

`exportSnapshot()` + `DataTableExportSnapshot` type + spec.

### Phase C — Export core (model, writers, file helpers)
- **Status:** done
- **Started:** 2026-10-19 21:38
- **Ended:** 2026-10-19 21:45

Add `jspdf` and `jspdf-autotable` (exact versions ≥ 2 weeks old) to `packages/frontend`.
`export.model.ts`, `export-writers.ts` (incl. `PdfPageSetup`, `planPdfLayout`), `export-file.ts`
+ specs (fit matrix: 5 formats × 2 orientations × 3 fit modes). Check the lazy chunk does not
trip the bundle budget warnings in `angular.json` (initial bundle must stay unchanged).

### Phase D — Report builders
- **Status:** done
- **Started:** 2026-10-19 21:38
- **Ended:** 2026-10-19 21:41

`category-export.ts` (+ export `compareReportRows`), `list-export.ts` + specs. Depends on the
types in `export.model.ts` and `DataTableExportSnapshot` as specified above (can start in parallel
with B/C against those signatures).

### Phase E — Service, dialog, ribbon band, i18n
- **Status:** done
- **Started:** 2026-10-19 21:45
- **Ended:** 2026-10-19 22:04

`TransactionsExport`, source registration in both tabs, `periodText` into the store, Export band,
export dialog (layout from A), i18n en/de, specs (dialog: format/depth/scope rendering, export
click calls writer + download with the right name; shell: band button opens dialog).

### Phase F — Docs, gates, browser check
- **Status:** done
- **Started:** 2026-10-19 22:04
- **Ended:** 2026-10-19 22:22

Transactions-table skill note; `pnpm format:fix && pnpm format:check && pnpm lint && pnpm test &&
pnpm build`. Browser check (`run` skill): set a period, exclude an account, open Export on
by-category, export CSV/PDF/JSON at depth 1, 2 and "every transaction"; verify sums match the
screen and the file names; for PDF open the files and check that nothing is clipped at the
right margin in A4 portrait/landscape and A5 with each fit mode; repeat on the list view with a column filter + reordered columns.

**Progress:** skill note added; all gates green. Build fixes: the dialog's generic control styles moved to `_dialog.scss` (`.app-dialog__segmented/__segment/__select/__range/__radio/__label/__sublabel/__hint`) to stay under the 4 kB component-style budget; `allowedCommonJsDependencies` lists jspdf's optional CJS deps (core-js, html2canvas, raf, rgbcolor). The initial-bundle budget warning predates this plan (673 kB on HEAD, 688 kB now). Browser check (2026-10-19, real data, de): both views, all formats, depths 2/4/all, A4 portrait/landscape, all three fit modes; sums match the table, nothing clipped at the margin. Fixed from it: CSS-auto-table column allocation (text columns capped at 35 % of the width, min = longest word ≤ 25 mm), wrapping headers, bold texts measured bold, PDF document title, empty transaction columns dropped at category-only depths, viewer thumbnail pane hidden (`navpanes=0`). The download click itself was not exercised in the browser (covered by specs).

## Execution

| Step | Agent | Model / effort | Wave | Write set | Reads |
|---|---|---|---|---|---|
| A | main session + frontend-design | — | 1 | scratchpad mockups | `_dialog.scss`, assign-dialog, ribbon |
| B | implementer-light | sonnet / low | 1 | `data-table.component.ts`, `data-table.model.ts`, its spec | data-table component |
| C | implementer | sonnet / medium | 1 | `export/export.model.ts`, `export-writers.ts`, `export-file.ts` + specs, frontend `package.json`, lockfile | this plan |
| D | implementer | sonnet / medium | 1 | `export/category-export.ts`, `export/list-export.ts` + specs, `category-report.ts` | `data-table-tree.ts`, by-category component, this plan |
| E | implementer | opus / medium | 2 | `export/transactions-export.ts`, `export/export-dialog/*`, shell, both tab components, store, i18n | A result, B–D outputs |
| F | main session | — | 3 | transactions-table skill | — |
