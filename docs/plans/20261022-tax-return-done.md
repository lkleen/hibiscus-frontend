# Tax return — a separate application feature (German income tax)

**Plan status:** done

## Context

The by-category export mirrors the on-screen tree. A tax return needs something else: the
tax-relevant categories, grouped the way the ESt forms are laid out, as positive totals, with the
transactions behind each total as a numbered receipt list, plus guidance on what belongs where.

Decisions (user, 2026-10-22):

- A **separate application feature** (own route, own main nav entry), for **German income tax
  only** (UI en/de). It does **not** touch or reuse the transactions export:
  `features/transactions/export/` stays unchanged.
- **Flow:** the user picks the **tax year** first. Next the app goes through the **existing
  categories** with them to identify the tax-relevant ones. Then come the check and the result.
- **Assistance:** life-situation questions, suggested tags, a year-over-year check.
- **Entry points outside the feature:** the categories page (tax section column and a tag action),
  and a seasonal hint.
- Categories are **tagged once** and the tags are reused every year. They are stored in **Hibiscus
  `umsatztyp.nummer`**, so they are visible and editable in the desktop client.

Facts from the local DB that shape the design:

- `nummer` is `varchar(5)`, so a tag is a short code with no room for free text. **0 of 304**
  categories use `nummer` today.
- `nummer` decides automatic matching. A transaction without a stored category goes to the first
  matching category by `ORDER BY COALESCE(nummer,''), name` (`assignCategories()`,
  `core/utils/category-matching.ts`). 253 categories have patterns and **9,670 transactions have no
  stored category**. A tagged category sorts after every untagged one, so tagging can move
  pattern-matched transactions, here and in the desktop client. **Every tag save previews that
  impact and saves only after confirmation**, from the wizard and from the categories page alike.

The draft `docs/plans/20261022-tax-return-wizard-planning.md` (written before these decisions) is
replaced by this plan when execution starts (persisted as `20261022-tax-return-accepted.md`, per the
`plan-mode` skill).

## User flow

```
Nav "Tax return" ─┐
Seasonal hint ────┼─▶ /tax-return ── pick year (default: last year) ──▶ /tax-return/:year
Categories page ──┘     (tag action there opens the shared tag dialog, see below)

/tax-return/:year — stepper, steps reachable freely once step 1 has ≥ 1 tag
  ① Categories   life situation → suggested tags → review the category tree → save (impact preview)
  ② Unassigned   the year's transactions without a category: assign, create or edit categories
  ③ Check        remaining open items, each with a fix
  ④ Result       summary per form + receipt lists on screen, PDF
```

The year picker also has the account filter (`<app-account-filter>`, all accounts checked by
default), so a business account can be left out.

- **First run:** an intro above the stepper says what you get (totals per form section and a
  numbered receipt list) and what the feature doesn't do (no ELSTER submission, no tax advice). The
  steps run in order.
- **Later years:** step ① opens collapsed to a summary ("7 sections, 23 categories tagged"). The
  user re-checks only new or untagged categories (step ① lists the categories that have transactions
  in the year but no section) and continues to ②.

### Step ① — Identify tax-relevant categories

1. **Life situation** (first run, editable later): yes/no questions. Are you employed? Do you have
   children? Did you pay for household services or craftsmen? Do you rent out property? Do you
   donate or pay church tax? Each answer switches sections on or off. Vorsorgeaufwendungen and
   außergewöhnliche Belastungen are always on. Stored per user in `hf_user_setting`.
2. **Suggested tags:** for every untagged category without an inherited section, the app proposes
   a section of an enabled section whose keywords match the category's path (e.g. "Versicherung" →
   `St-VA`, "Arzt"/"Apotheke" → `St-AB`, "Kita" → `St-KI`, "Handwerker" → `St-HH`). The list shows
   the category, the year's count and sum, and the suggested section, with accept or reject per row
   and "accept all". Nothing is saved yet.
3. **Category tree:** every category with the year's count and sums, and a section picker per row.
   Inherited sections are shown muted, and `St-0` excludes a branch. A guidance panel explains the
   selected section: what belongs there, receipts to keep, the form.
4. **Save:** the shared **tag dialog flow**: impact preview (transactions that change category),
   confirm, then a sequential `PUT /api/categories/:id` per changed category with `expected`. It
   stops on the first `409`, reloads, and reports what was saved.

### Step ② — Unassigned transactions

A transaction is unassigned when it has no stored category **and** no category pattern matches it
(`assignCategories()` → `null`). These are the transactions the result would silently miss.

- A list of the year's unassigned transactions (`<app-data-table>`, the transactions list's
  columns, sorted by absolute amount descending so the large ones come first), with the count and
  sum in the header, search, and multi-row selection.
- **Assign** (single row or the selection, bulk) through the existing Assign dialog
  (`TransactionDialogs`, `POST /api/transactions/assign-category`, all-or-nothing, `409` safe).
- **Create category** from a transaction through the existing category dialog, prefilled by
  `categoryDraftFrom` (pattern from payee or purpose, with the live preview of matching
  transactions). After a create in this feature, the tag dialog asks for the new category's tax
  section (skippable).
- **Edit category…** (toolbar): pick an existing category, open the existing category edit dialog
  (e.g. widen its pattern; the live preview shows which transactions it would now catch).
- Assigned rows leave the list immediately (the store's `revision` bump). An empty list shows
  "All transactions of <year> have a category ✓".

### Step ③ — Check (each item with a count, a sum and a fix action)

- Tagged categories with both income and expenses (refunds, to check).
- Sections enabled by the life situation but empty ("you have children, but Kinderbetreuung is
  empty").
- **Year over year:** sections whose total differs from the previous year by more than 50 % and
  100 €, or that had transactions last year and none now. It uses the current tags and matching on
  last year's data. The UI says so.

### Step ④ — Result

The summary per form section (income and expenses, both positive, kept apart), the receipt lists
(running number, date, payee, IBAN, purpose, category, amount), guidance on which form each block
goes to, and fixed legal facts (e.g. §35a counts only the labour part and only when paid by bank
transfer). Then a PDF download.

All guidance texts are qualitative: **no amounts, limits or form line numbers**, which change every
year. Every step shows a short "no tax advice; check the current form instructions in ELSTER"
note.

### Entry points outside the feature

- **Categories page** (`features/categories/categories.component.ts`): a "Tax section" column (the
  effective section, inherited ones muted; the raw `nummer` column stays as it is) and a "Tax section…"
  row action. The action opens the shared tag dialog (section picker plus impact preview) from
  `core/tax/`.
- **Seasonal hint** on the start page (`features/accounts/`): from 1 January to 31 July, a
  dismissible banner, "Prepare your tax return <last year>", linking to `/tax-return/<last year>`.
  The dismissal is stored per year in the same user setting. No data loading on the accounts page.

## Design

### Shared tax core (`frontend/src/app/core/tax/`, used by the feature and the categories page)

- **`tax-sections.ts`** (pure): `TAX_SECTIONS` is the single source of truth (code, i18n keys,
  form, keywords for suggestions, the life-situation question that enables it).

  | Code    | Section                                                   | Form                                | Enabled by        |
  |---------|-----------------------------------------------------------|-------------------------------------|-------------------|
  | `St-WK` | Werbungskosten als Arbeitnehmer                           | Anlage N                            | employed          |
  | `St-VA` | Vorsorgeaufwendungen                                      | Anlage Vorsorgeaufwand              | always            |
  | `St-SA` | Sonderausgaben (Kirchensteuer, Spenden, eigene Ausbildung) | Anlage Sonderausgaben              | donations/church  |
  | `St-AB` | Außergewöhnliche Belastungen                              | Anlage Außergewöhnliche Belastungen | always            |
  | `St-HH` | Haushaltsnahe Dienstleistungen und Handwerker (§35a EStG) | Anlage Haushaltsnahe Aufwendungen   | household         |
  | `St-KI` | Kinderbetreuung, Schulgeld                                | Anlage Kind                         | children          |
  | `St-V`  | Vermietung und Verpachtung                                | Anlage V                            | rental            |
  | `St-0`  | Not tax-relevant (overrides a tagged parent)              | —                                   | —                 |

  `parseTaxCode(nummer)` returns `section | untagged | foreign`. A foreign value is never
  overwritten without explicit confirmation. `effectiveTaxSection(category, byId)` returns the own code
  or the nearest tagged ancestor's. `St-0` stops the inheritance, and a cycle throws.
  `suggestTaxSections(categories, enabled)`. A spec asserts every code is at most 5 characters.
- **`tax-tag-impact.ts`** (pure): `taxTagImpact({ transactions, categories, accountsById, proposed })`
  runs `assignCategories()` twice and returns the transactions whose category changes.
- **`tax-tag-save.ts`**: the sequential `PUT` with `409` handling, used by the wizard and the
  categories page.
- **`tax-tag-dialog/`**: the shared section picker and impact-preview dialog (CDK dialog like the
  existing dialogs, `_dialog.scss`).

### User setting `tax-profile` (follows `table-densities` exactly)

- `shared/src/contracts/user-settings.d.ts`: `TaxProfile = { situations: Record<TaxSituation,
  boolean | null>; hintDismissedYear: number | null }`, `TaxSituation` as a string union.
- `backend/src/settings/tax-profile.ts` (key, default, zod schema) and `GET`/`PUT
  /api/settings/tax-profile` in `backend/src/routes/settings.ts`, with specs mirroring
  `settings.spec.ts`.
- `frontend/src/app/core/services/tax-profile.service.ts`, mirroring `table-density.service.ts`.

### Feature (`frontend/src/app/features/tax-return/`)

- `tax-return.routes.ts`: `''` (year picker) and `':year'` (stepper). An invalid year redirects to
  the picker.
- The feature component **provides `TransactionsStore`, `TransactionDialogs` and
  `CategoryDialogs`** itself, the same way the transactions shell does. That gives the loading,
  `categoryAssignment`, `saveTransaction`/`assignCategory`, `saveCategory` (`CategoryEditSource`)
  and every dialog without duplicating them or refactoring them. Phase E first verifies that
  `TransactionsStore` has no dependency on the transactions shell (e.g. the ribbon or the
  `DataTableToolbarOutlet`). If it has one, the dependency is made optional there, and nothing
  is copied.
- `TaxReturnStore` (component-provided, injects `TransactionsStore`) adds the year, the accounts,
  the draft tags, the tax profile, and the `computed` report and findings.
- `tax-report.ts` (pure): `buildTaxReport({ transactions, assignment, categories, year })` gives the
  sections with categories (income and expenses positive, count), the receipts (numbered across
  sections by section, date, id) and the findings (unassigned, mixed, empty-but-enabled). The year
  over year comparison calls it for `year - 1` and compares. Transaction values stay raw
  (`transactions-table` skill §2).
- `tax-pdf.ts`: `toTaxPdf(report, labels): Promise<Blob>`, using `jspdf` + `jspdf-autotable`
  (already dependencies) via `import()`. Page 1 has the summary and the disclaimer, then one block per
  section with its receipts. A footer shows the year, the generation date and the page number. The file
  is `steuer-<year>.pdf` (`tax-return-<year>.pdf` in English).
- Step components: `step-categories/` (situation, suggestions, tree via `<app-data-table>` in tree
  mode), `step-unassigned/` (list + the reused dialogs), `step-check/`, `step-result/`.
- Nav entry `nav.taxReturn` in `core/components/header/header.component.ts`, and the route in
  `app.routes.ts`.

### Reused, unchanged

`ApiService`, `assignCategories()`, `category-path.ts`, `<app-data-table>` (no `<p-table>` in the
feature), `computeTreeAggregates` if sums are shown in the tree, `TransactionsStore` (its
`transactionColumns` for the unassigned list), `TransactionDialogs` (Assign, Edit, Create category
menu items), `CategoryDialogs` (create/edit with live preview), `categoryDraftFrom`.

### Race conditions

- Tag saves send `expected` values, so a row changed meanwhile answers `409` and is never
  overwritten. The impact is recomputed after a reload, before the next save.
- The categories page and the wizard save through the same `tax-tag-save.ts`. Each keeps its own
  loaded state and reloads after a save.
- The report and findings are `computed` over store signals (`revision`), so an assign or a
  category edit in ② updates ②, ③ and ④ at once. Bulk assign keeps the existing guarantees: only
  selected, visible rows, all-or-nothing, `409` with `conflictIds`.
- Creating or editing a category in ② changes the matching. The unassigned list, the report and
  the impact baseline are all `computed` from the same `categories` signal, so they cannot
  disagree.
- `tax-profile` `PUT` replaces the whole object (same as `table-densities`), so the last write wins.
  This is acceptable for a per-user setting.

## Phases

Each phase carries status / started / ended per the `plan-mode` skill.

- **A — Mockups** (main session + `frontend-design:frontend-design`): clickable HTML mockups in the
  scratchpad of the year picker, step ① (situation, suggestions, tree with guidance panel), the
  impact dialog, ② and ③, the categories-page column and action, and the seasonal hint. The user picks.
- **B — Tax core:** `tax-sections.ts` (+ suggestions) and `tax-tag-impact.ts`, with specs.
- **C — `tax-profile` setting:** shared type, backend setting and route, frontend service, specs.
- **D — `tax-report.ts`** + spec (scope, inheritance, `St-0`, income/expense split, numbering,
  findings, year over year).
- **E — Tag save + shared tag dialog**, wizard UI (routes, stores, year/account picker, four steps
  including the unassigned workspace with the reused dialogs, intro), nav, en/de texts. The guidance texts are drafted by the main session and reviewed by the user.
- **F — `tax-pdf.ts`** + spec (mocked jspdf, as in `export-writers.spec.ts`).
- **G — Categories page column and action, seasonal hint** on the accounts page.
- **H — Docs and verification:** `docs/architecture.md` (route, `nummer` writes and the matching
  side effect, new setting and routes), a §2.5 note in the `transactions-table` skill, the five
  gates, and a browser check.

## Execution

| Step | Agent | Model / effort | Wave | Write set | Reads |
|---|---|---|---|---|---|
| A | main session + frontend-design | — | 1 | scratchpad mockups | categories page, accounts page, `_dialog.scss` |
| B | implementer | sonnet / medium | 1 | `core/tax/tax-sections.ts`, `tax-tag-impact.ts` + specs | `categories.d.ts`, `category-matching.ts` |
| C | implementer-light | sonnet / low | 1 | `user-settings.d.ts`, `backend/src/settings/tax-profile.ts`, `routes/settings.ts`, `tax-profile.service.ts` + specs | `table-density` files (pattern) |
| D | implementer | sonnet / medium | 2 | `features/tax-return/tax-report.ts` + spec | B, `category-path.ts` |
| F | implementer | sonnet / medium | 3 | `features/tax-return/tax-pdf.ts` + spec | D, `export-writers.ts` (pattern only) |
| E | implementer | opus / medium | 3 | `core/tax/tax-tag-save.ts`, `core/tax/tax-tag-dialog/*`, `features/tax-return/*` (except D, F), `app.routes.ts`, header, `en.json`, `de.json` | A choice, B–D |
| G | implementer | sonnet / medium | 4 | `features/categories/categories.component.*`, `features/accounts/*`, `en.json`, `de.json` | E (tag dialog), C |
| H | main session | — | 5 | `docs/architecture.md`, transactions-table skill | — |

## Verification

- `pnpm format:fix`, `pnpm format:check`, `pnpm lint`, `pnpm test`, `pnpm build`: green, no warnings.
- `git diff --stat` shows no change under `features/transactions/export/`.
- Browser check against the local DB (`pnpm start:local`), en and de:
  - pick 2025, answer the life-situation questions, accept a suggestion;
  - confirm the impact preview lists the moved transactions, then save;
  - check `nummer` in MariaDB and that the by-category view regroups as previewed;
  - in ②, bulk-assign two unassigned transactions, create a category from one (and tag it), and
    widen an existing category's pattern; check that they leave the list;
  - walk through ③ and ④ and open the PDF;
  - tag from the categories page;
  - see the hint on the accounts page and dismiss it.
  
  Afterwards, untag all test tags and revert the test assignments and categories to restore the
  data.

## Phase tracking

| Phase | Status | Started | Ended |
|---|---|---|---|
| A — Mockups (variant A chosen) | done | 2026-10-22 20:00 | 2026-10-22 20:19 |
| B — Tax core | done | 2026-10-22 20:00 | 2026-10-22 20:19 |
| C — tax-profile setting | done | 2026-10-22 20:00 | 2026-10-22 20:19 |
| D — tax-report.ts | done | 2026-10-22 20:00 | 2026-10-22 20:19 |
| E — Wizard UI | done | 2026-10-22 20:19 | 2026-10-22 20:48 |
| F — tax-pdf.ts | done | 2026-10-22 20:19 | 2026-10-22 20:21 |
| G — Categories page + seasonal hint | done | 2026-10-22 20:42 | 2026-10-22 20:48 |
| H — Docs and verification (the browser check found that tags in `nummer` change matching; tag storage redone in `20261026-tax-tags-table-done.md`, which also ran the browser check) | done | 2026-10-22 20:48 | 2026-10-26 21:50 |
