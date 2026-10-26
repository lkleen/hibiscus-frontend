# Plan: tax tags table (status: done)

## Phases

| Phase | Status | Started | Ended |
|---|---|---|---|
| A — Shared contract | done | 2026-10-26 20:40 | 2026-10-26 20:41 |
| B — Backend table, repository, route | done | 2026-10-26 20:41 | 2026-10-26 20:50 |
| C — Frontend core (service, tax core) | done | 2026-10-26 20:41 | 2026-10-26 20:58 |
| D — Wizard, categories page, i18n | done | 2026-10-26 20:58 | 2026-10-26 21:25 |
| E — Docs and verification | done | 2026-10-26 21:25 | 2026-10-26 21:50 |

# Tax tags in an app-owned table instead of `umsatztyp.nummer`

## Context

The browser check of the tax-return wizard (plan `docs/plans/20261022-tax-return-done.md`,
phase H) showed that tagging through `umsatztyp.nummer` defeats its own purpose. Hibiscus assigns a
transaction without a stored category to the first matching category by
`ORDER BY COALESCE(nummer,''), name`. All 304 categories have an empty `nummer`, so a tagged category
sorts after all of them and loses its pattern-matched payments to them. Tagging
"Lebenshaltung / Apotheke" would move 12 pharmacy payments away (4 of them in 2025, e.g. to
"COMDIRECT VISA"), here and in the Hibiscus desktop client. Nothing was saved, and `nummer` is still
unused in the local DB.

User decision (2026-10-26): store the tags in a **separate relational table with data integrity**
that **does not break when ids change**. The rest of the feature (wizard flow, steps, life
situation, suggestions, report, PDF, categories-page column and action, seasonal hint) stays as built.

## Design

### Database (app-owned, created at startup like `hf_user_setting`)

```sql
CREATE TABLE IF NOT EXISTS hf_tax_section (
  code VARCHAR(16) NOT NULL PRIMARY KEY
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS hf_category_tax_tag (
  category_id INT(10) NOT NULL PRIMARY KEY,
  code VARCHAR(16) NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_hf_tax_tag_category FOREIGN KEY (category_id) REFERENCES umsatztyp (id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_hf_tax_tag_section FOREIGN KEY (code) REFERENCES hf_tax_section (code)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

- **Id changes:** `ON UPDATE CASCADE` makes the tag follow a changed category id. A category
  deleted in the desktop client takes its tag with it (`ON DELETE CASCADE`). There are never
  orphans and never a tag on the wrong category. `category_id` matches `umsatztyp.id` (`int(10)`
  signed, InnoDB, verified locally on MariaDB 10.11).
- **Valid codes:** `hf_tax_section` is seeded at startup from the one code list (`INSERT IGNORE`;
  existing rows are never deleted). An unknown code is rejected by the DB, not only by zod. A code
  still in use cannot be removed (`RESTRICT`).
- Startup fails loudly if the FK cannot be created (e.g. a MyISAM `umsatztyp`). Nothing falls back.
- No migration is needed: `nummer` holds no tax codes (0 of 304 rows). The app stops writing tax
  codes to `nummer`. The category editor still edits `nummer` as a plain Hibiscus field.

### Shared contract: `packages/shared/src/contracts/tax-tags.d.ts` (new, types only)

```ts
export type TaxSectionCode = 'St-WK' | 'St-VA' | 'St-SA' | 'St-AB' | 'St-HH' | 'St-KI' | 'St-V';
/** A section, or 'St-0': not tax-relevant, stops inheritance from a tagged parent. */
export type TaxTagCode = TaxSectionCode | 'St-0';
export interface TaxTag { readonly category_id: number; readonly code: TaxTagCode; }
/** One change; `expected` is the tag the edit started from (null = untagged). expected !== next. */
export interface TaxTagChange {
  readonly category_id: number;
  readonly expected: TaxTagCode | null;
  readonly next: TaxTagCode | null;
}
export interface TaxTagsUpdateRequest { readonly changes: readonly TaxTagChange[]; }
export interface TaxTagsConflict { readonly error: 'conflict'; readonly conflictIds: readonly number[]; }
```

`TaxSectionCode` moves here from `core/tax/tax-sections.ts`, which imports it from here.

### Backend

- `src/tax/tax-tag-codes.ts`: `TAX_TAG_CODES` (`as const satisfies readonly TaxTagCode[]`) with the
  same compile-time completeness check as `TAX_SITUATIONS` in `src/settings/tax-profile.ts`.
- `src/repositories/tax-tag.ts`:
  - `ensureTaxTagTables()` creates both tables and seeds the codes; `server.ts` calls it after
    `ensureUserSettingTable()`.
  - `listTaxTags()`.
  - `applyTaxTagChanges(request)`: one DB transaction, changes in ascending `category_id` (the
    deadlock rule of `assignCategory` in `umsatz.ts`), all or nothing. Per change:
    - null → code: `INSERT`; a duplicate key means a conflict;
    - code → code: `UPDATE … WHERE category_id = ? AND code = ?`;
    - code → null: `DELETE … WHERE category_id = ? AND code = ?`.

    Zero affected rows, a duplicate key (`ER_DUP_ENTRY`) or a missing category
    (`ER_NO_REFERENCED_ROW_2`) is a conflict for that id. Any conflict rolls back and returns
    `{ result: 'conflict', conflictIds }`.
- `src/routes/tax-tags.ts`, mounted at `/api/tax-tags` behind the existing auth:
  - `GET` returns `TaxTag[]`;
  - `PUT` takes a zod-validated `TaxTagsUpdateRequest`: `.strict()`, codes from `TAX_TAG_CODES`,
    1–500 changes, unique `category_id`, `expected !== next`. It answers `204`, `400`, or `409`
    with a `TaxTagsConflict`.
- Specs mirror `routes/transactions.spec.ts` (assign-category) and `repositories/*.spec.ts`.

### Frontend

- `ApiService`: `getTaxTags(): Observable<TaxTag[]>`,
  `saveTaxTags(request: TaxTagsUpdateRequest): Observable<void>`.
- `core/services/tax-tags.service.ts` (root, mirrors `tax-profile.service.ts`):
  - `tags: Signal<ReadonlyMap<number, TaxTagCode> | null>`, null until loaded.
  - `load(): Observable<void>`.
  - `save(changes): Observable<void>`. On `409` it reloads the tags, then errors with
    `TaxTagConflictError` (carries `conflictIds`). A single `save` in flight; a second call while
    one runs throws.
- `core/tax/tax-sections.ts`:
  - `effectiveTaxSection({ category, byId, tags })` and `suggestTaxSections({ categories, enabled,
    tags })` read the tag map instead of `nummer`.
  - `parseTaxCode` and the `foreign` kind are removed.
  - `TAX_EXCLUDED_CODE` is typed `'St-0'` from the contract.
- **Removed:** `core/tax/tax-tag-impact.ts`, `core/tax/tax-tag-save.ts` (sequential `PUT
  /api/categories`) and the batch impact dialog, with their specs. A tag no longer changes matching,
  so there is nothing to preview. `TaxTagDialogs` keeps only `openSection` (categories page): the
  picker and Save, then `TaxTagsService.save`, with the conflict message inline.
- **Wizard** (`features/tax-return/`): `TaxReturnStore` overlays its draft on
  `TaxTagsService.tags()` instead of on `nummer`. "Save tags" saves directly with the service (no
  dialog). A conflict keeps the draft, shows the reloaded state and names the conflicting
  categories. Steps ②–④, the report and the PDF read effective sections through the new
  signature. The `reloadCategories()` methods added for the old 409 flow stay only if still used;
  otherwise they are removed.
- **Categories page:** the "Tax section" column reads the service and the action uses
  `openSection`. The raw `nummer` column stays as it is.
- **i18n:** remove the keys for the impact preview and foreign codes, and add the conflict text
  (en and de).

### Docs

- `docs/architecture.md`:
  - list the two new tables and the `GET`/`PUT /api/tax-tags` routes in the write scope;
  - replace the "Tax return" section's `nummer` and matching side-effect text with the table, its
    FKs and the save contract.
- `.claude/skills/transactions-table/SKILL.md`: remove the §2.5 tax-tag note. Matching is unaffected
  again.
- `docs/plans/20261022-tax-return-done.md`: phase H notes the redesign and points to this plan.

### Race conditions

- Tag saves are conditional on `expected` inside one transaction, so a concurrent edit from a
  second tab answers `409` and never overwrites. The ascending `category_id` order avoids deadlocks.
  A concurrent first-time insert is caught by the primary key.
- A category deleted in the desktop client during a save raises an FK error. That is a `409` for
  that id; the client reloads.
- The wizard's report and the categories page read the same root `tags` signal, so after a save
  both show the same state.

## Execution

| Step | Agent | Model / effort | Wave | Write set | Reads |
|---|---|---|---|---|---|
| A | main session | — | 1 | `shared/src/contracts/tax-tags.d.ts`, `docs/plans/20261026-tax-tags-table-*.md` | this plan |
| B | implementer | sonnet / medium | 2 | backend `src/tax/tax-tag-codes.ts`, `src/repositories/tax-tag.ts`, `src/routes/tax-tags.ts`, `server.ts` (+ route mount file), specs | `umsatz.ts` `assignCategory`, `routes/transactions.ts`, `user-setting.ts`, `settings/tax-profile.ts` |
| C | implementer | sonnet / medium | 2 | frontend `core/services/api.service*`, `core/services/tax-tags.service*`, `core/tax/**` (incl. deletions) | A, `tax-profile.service.ts` |
| D | implementer | opus / medium | 3 | `features/tax-return/**`, `features/categories/**` (tax parts), `features/transactions/*.store.ts` (`reloadCategories` cleanup only), `en.json`, `de.json` | C's pinned signatures |
| E | main session | — | 4 | `docs/architecture.md`, transactions-table skill, old plan | — |

B and C run in parallel against the contract pinned above. D starts after C (it consumes the new
signatures).

## Verification

- `pnpm format:fix`, `pnpm format:check`, `pnpm lint`, `pnpm test`, `pnpm build`: green (the
  pre-existing bundle-budget warning excepted, as reported).
- DB, after a backend start:
  - `SHOW CREATE TABLE hf_category_tax_tag` shows both FKs;
  - `hf_tax_section` holds 8 codes;
  - an `INSERT` with an unknown code or category id fails;
  - `UPDATE umsatztyp SET id = …` on a test category carries its tag;
  - deleting the test category removes the tag.

  Run in a transaction or on a throw-away category, then roll back or delete.
- Browser (Claude in Chrome, `/en` and `/de`), continuing phase H:
  - pick 2025, accept the Apotheke suggestion and save. No dialog; `hf_category_tax_tag` has the
    row and `umsatztyp.nummer` is unchanged; by-category grouping is unchanged.
  - in ②, bulk-assign, create a category and tag it, edit a category;
  - walk through ③ and ④ and open the PDF;
  - tag from the categories page;
  - see the hint and dismiss it;
  - a conflict: change a tag in a second tab, then save in the first, and expect the conflict message.
- Restore afterwards:
  - delete the test tags;
  - revert assignments and categories from the backup in the scratchpad (`db-backup/`);
  - restore the `tax-profile` setting.
