# Tax tags in categories (remove the tax return wizard)

**Status:** done

Plan of record on execution: `docs/plans/20261028-tax-tags-in-categories-<status>.md`.

## Context

The four-step tax return wizard (commit 76cd597, e5830ef) is removed. What stays is the tagging of
categories with a tax section (`hf_category_tax_tag`), now handled where categories are handled:
the categories table and the category edit dialog. Tax sections and their guidance stop being
hard-coded: the user maintains them (code, name, form, guidance). The by-category export can be
limited to categories of chosen tax sections.

Decisions (from the user):

- The tax tag is saved **in the same request** as the category (one DB transaction).
- Export filter only in the **by-category** view; the user **picks which sections** to include.
- Remove everything of the wizard **except tags and guidance**; sections + guidance become
  **user-maintained**.

Defaults I chose (say so if you want otherwise):

- Seeded section texts are the current **German** ones (German tax return; DB text is one
  language). Seeded **once** — a deleted section does not come back on restart.
- `St-0` ("not tax-relevant") stays a fixed built-in code: not listed, edited or deleted as a section.
- A section in use cannot be deleted (409, "retag first"); renaming its code cascades to tags.
- Sections are ordered by code.
- Section maintenance lives in a **"Tax sections…" dialog** opened from the categories ribbon.
- The orphaned `tax-profile` user-setting row is left in the DB (harmless, no reader).

## Phases

### Phase A — Shared contracts

- **Status:** done
- **Started:** 2026-10-28 08:03
- **Ended:** 2026-10-28 08:06

`packages/shared/src/contracts/`:

- `tax-tags.d.ts`: `TaxSectionCode` → `string`; `TaxTagCode = string`; keep `TaxTag`. Add
  `TaxSection { code, name, form, belongs, excludes, receipts, note }` (texts `string | null`
  except `code`, `name`), `TaxSectionUpdateRequest { expected, next }`, `TaxSectionError`
  (`'conflict' | 'in-use' | 'duplicate'`). Remove `TaxTagChange`, `TaxTagsUpdateRequest`,
  `TaxTagsConflict` (bulk PUT goes away).
- `categories.d.ts`: `CategoryCreateRequest = CategoryEditableFields & { taxTag: TaxTagCode | null }`;
  `CategoryUpdateRequest` gains `taxTag: { expected: TaxTagCode | null; next: TaxTagCode | null }`.
- `user-settings.d.ts`: remove `TaxProfile`, `TaxSituation`.

### Phase B — Backend

- **Status:** done
- **Started:** 2026-10-28 08:15
- **Ended:** 2026-10-28 08:20

- `repositories/tax-tag.ts`: `ensureTaxTagTables` migrates `hf_tax_section` to
  `(code PK, name, form, belongs, excludes, receipts, note)`: create with full columns and seed
  defaults when the table is new; when it exists without `name`, `ADD COLUMN`s and fill defaults
  per existing code (seed once). `St-0` row kept for the FK. Seed data in `tax/tax-section-defaults.ts`
  (texts from `de.json` `tax.sections.*`); replaces `tax/tax-tag-codes.ts`.
  Keep `listTaxTags`; replace bulk `applyTaxTagChanges` by a guarded single-change helper taking a
  connection (reuse `applyChange` logic).
- New `repositories/tax-section.ts` + `routes/tax-sections.ts`: `GET /api/tax-sections` (without
  St-0), `POST` (201; 409 `duplicate`), `PUT /:code` with `{expected, next}` (409 `conflict`),
  `DELETE /:code` (409 `in-use` on `ER_ROW_IS_REFERENCED_2`). Zod: code `^[A-Za-z0-9-]{1,16}$`,
  never `St-0`. Register in `server.ts`.
- `repositories/umsatztyp.ts` + `routes/categories.ts` + `categories/category-update.ts`: create
  and update run in one transaction with the tag change; a tag conflict answers 409 like a category
  conflict; unknown section code → 400.
- `routes/tax-tags.ts`: GET only. Remove `settings/tax-profile.ts` and the `/tax-profile` routes.
- Specs: adapt `tax-tag.spec.ts`, `tax-tags.spec.ts`, `categories.spec.ts`, `umsatztyp.spec.ts`,
  `settings.spec.ts`; new `tax-section(s).spec.ts`.

### Phase C — Frontend removal

- **Status:** done
- **Started:** 2026-10-28 08:15
- **Ended:** 2026-10-28 08:17

Delete `features/tax-return/`, `core/tax/tax-tag-dialog/`, `core/tax/tax-section-picker/tax-section-picker.*`,
`core/services/tax-profile.service*`. Remove the `tax-return` route (`app.routes.ts`), nav entry
(`header.component.ts`), full-width rule (`app.component.scss`), accounts tax hint
(`accounts.component.*`), `getTaxProfile/saveTaxProfile` + `saveTaxTags` (`api.service*`), the
"Tax section…" row menu and `TaxTagDialogs` provider (`categories.component.*`).
`tax-sections.ts`: drop keywords, `enabledBy`, suggestions, `enabledSections`; keep
`effectiveTaxSection` (now over loaded sections). Keep the `<app-data-table>` row-handler fix and
`CategoryDialogs.openCreate` returning the created row.

### Phase D — Frontend services

- **Status:** done
- **Started:** 2026-10-28 08:15
- **Ended:** 2026-10-28 08:21

- New root `TaxSectionsService` (`core/services/tax-sections.service.ts`): `sections` signal,
  `load()`, `create/update/remove` updating the signal from server answers.
- `TaxTagsService`: drop bulk `save`; add `applySaved(categoryId, code | null)` called after a
  category save.
- `api.service.ts`: tax-section CRUD; `createCategory/updateCategory` send `taxTag`.
- `core/tax/tax-i18n.ts` → descriptions built from `TaxSection` data, not i18n keys. Move
  `tax-description.component.ts` to `core/tax/tax-description/`.

### Phase E — Categories table + edit dialog (UI)

- **Status:** done
- **Started:** 2026-10-28 08:40
- **Ended:** 2026-10-28 09:05

Invoke `frontend-design` first.

- Table: keep the "Tax section" column; names come from `TaxSectionsService`.
- Edit dialog (`features/categories/edit-dialog/`): a "Tax section" field — select with
  "As parent (X)" / each section / "Not tax-relevant" — plus `<app-tax-description>` of the chosen
  option. Part of `draft`/`changed`; works in create mode (also from the transactions page).
  `CategorySave` + `save-category.ts` carry the tag; on success call `TaxTagsService.applySaved`.
  The dialog loads tags/sections if not loaded yet.

### Phase F — Tax section maintenance dialog (UI)

- **Status:** done
- **Started:** 2026-10-28 08:40
- **Ended:** 2026-10-28 09:45

Invoke `frontend-design` first; show an HTML mockup for approval before building.
User picked variant **B (expanding rows)** from the mockup (2026-10-28). The dialog lives in
`features/categories/tax-section-dialog/` (its only consumer is the categories page).
"Tax sections…" button in the categories ribbon opens a CDK dialog: list (`<app-data-table>`) +
form (code, name, form, belongs, excludes, receipts, note), New / Save / Delete, conflict and
in-use errors inline.

### Phase G — By-category export filter

- **Status:** done
- **Started:** 2026-10-28 08:40
- **Ended:** 2026-10-28 09:05

- `export.model.ts`: `ExportOptions.taxSections: readonly string[] | null` (null = no filter).
- `ExportSource.build(options)` instead of `build(depth)`; list view ignores the filter.
- New `filterReportByTaxSections(rows, keep)` next to `category-report.ts`: keeps transactions of
  categories whose effective section is selected, plus ancestor category rows for the tree; drops
  the unassigned node. Applied in `transactions-by-category.component.ts` before
  `buildCategoryExport`.
- Export dialog: "Only tax sections" switch + checkbox per section (by-category only); scope
  lists the chosen sections in the document header.

### Phase H — Docs, i18n, gates

- **Status:** done
- **Started:** 2026-10-28 09:10
- **Ended:** 2026-10-28 09:50

Remove wizard/profile i18n keys (`tax.*` except what remains used, `nav.taxReturn`) from both
`en.json` and `de.json`; add new keys. Update `docs/architecture.md` (routes, tables, auth
unchanged). Run `pnpm format:fix && pnpm format:check && pnpm lint && pnpm test && pnpm build`.

## Execution

i18n files are owned by the coordinator: steps report their new/removed keys, the coordinator
applies them at the end of each wave.

| Step | Agent             | Model / effort  | Wave | Write set                                                     | Reads                             |
| ---- | ----------------- | --------------- | ---- | ------------------------------------------------------------- | --------------------------------- |
| A    | implementer-light | sonnet / low    | 1    | `shared/src/contracts/*`                                      | this plan                         |
| B    | implementer       | sonnet / medium | 2    | `backend/src/**`                                              | contracts, `docs/architecture.md` |
| C    | implementer-light | sonnet / low    | 2    | files listed in C                                             | this plan                         |
| D    | implementer       | sonnet / medium | 2    | `core/services/tax-*`, `api.service*`, `core/tax/**`          | contracts                         |
| E    | implementer       | opus / medium   | 3    | `features/categories/**` (not ribbon button)                  | D output                          |
| F    | implementer       | opus / medium   | 3    | `core/tax/tax-section-dialog/**`, categories ribbon button    | D output                          |
| G    | implementer       | sonnet / medium | 3    | `features/transactions/export/**`, `by-category/**`, `list/*` | D output                          |
| H    | coordinator       | —               | 4    | i18n, `docs/**`                                               | all                               |

Wave 2 write-set adjustment: D (not C) owns `api.service*`, `core/tax/tax-sections*`,
`core/tax/tax-i18n.ts`, `features/categories/categories.component.*` (menu removal + tax column on
loaded sections) and the minimal `taxTag` pass-through in `category-edit-dialog.model.ts`,
`save-category.ts` and the dialog's `save()`, so the frontend compiles after wave 2.

E and F both touch `categories.component.*`: F only adds the ribbon button; run F's edit to that
file after E finishes.

## Verification

- Backend specs: migration from the old one-column `hf_tax_section` (defaults filled once, not
  re-seeded after delete), section CRUD incl. 409s, category create/update with tag atomic (tag
  conflict rolls back the category change).
- Frontend specs: edit dialog saves tag with the category; categories column shows own/inherited/
  excluded; export filter keeps ancestors, drops other sections and the unassigned node.
- Quality gates (Phase H) all green.
- Manual in the browser (`pnpm start:local`): no "Tax return" nav entry; categories → edit →
  set section → table updates; Tax sections dialog → rename a code, edit guidance, delete an unused
  section, delete a used one (refused); Transactions → by category → Export → pick two sections →
  preview shows only those categories.

## Outcome notes

- Gates green. Remaining output not caused by this plan: NG0101 logged by the category dialog's
  300 ms preview spec under full-run load (reproduced at e5830ef), the initial-bundle budget warning,
  and the `vi.hoisted` warnings in `export-writers.spec.ts`.
- Open: no confirm step on deleting an unused section; dialog uses the standard 36rem width; the
  section code pattern exists in the backend schema and the dialog model (shared contracts are
  types-only).
