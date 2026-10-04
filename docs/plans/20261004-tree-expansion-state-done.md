# Tree mode: update nodes in place instead of rebuilding

## Context

In the "by category" tab, changing the period (◀/▶, the date range), the accounts or the search
gives `<app-data-table>` a new `value`. Today `treeNodes` (`data-table.component.ts` around
line 218) then calls `toTreeNodes` (`data-table-tree.ts`), which creates **new** `TreeNode` objects
with `expanded` reset to the `groupDefaultExpanded` default. Every node the user opened therefore
collapses again.

The user does not want the table to remember expansion separately. They want the tree to stop
being rebuilt, with only its underlying data updated. That replaces the previous
"expandedOverrides map" plan. The agent that was implementing it is stopped and its edits are
reverted.

## Approach: reconcile nodes by key (ag-Grid's `getRowId` update model)

A new `value` no longer produces fresh nodes. The existing `TreeNode` objects are **reused** by key
(`getRowId`), and only their contents change:

- A key that exists before and after keeps **the same node object**. Its `data` is set to the new
  row's proxy and `children` to the reconciled children, and `expanded` is left untouched. The
  expansion state is simply the node's own state, which PrimeNG already mutates in place when the
  user toggles a node. Nothing extra is stored.
- A new key gets a new node with the `groupDefaultExpanded` default for its depth.
- A key that is gone is dropped. If it comes back later, it comes back with the default state.
  This is a consequence of "update, don't remember".

Changes:

1. **`data-table-tree.ts`**: `toTreeNodes(rows, config)` gains
   `previous: ReadonlyMap<string, TreeNode<Data>>` in its config object (empty on the first build).
   It reuses and mutates matching nodes as described above, still using `buildTree` for the
   structure. Add a small helper `indexTreeNodes(roots)` that returns key → node for the next pass.
   Specs: a reused node keeps object identity and `expanded`, its data and children are updated,
   a new node gets the depth default, and a removed node is not resurrected.
2. **`data-table.component.ts`**:
   - `treeNodes` becomes a `linkedSignal({ source, computation: (src, previous) => … })`. The
     computation passes `previous?.value`, indexed, into `toTreeNodes`. This is Angular's built-in
     "previous value" hook, so there is no side-effect state in a `computed`.
   - `expandAll()`/`collapseAll()` walk the current nodes, set `expanded = true/false` in place,
     then `treeNodes.set([...roots])` so PrimeNG re-serializes. Later data updates keep that state,
     because the nodes are reused.
   - Remove the `expansion` linkedSignal and `TreeExpansion`, which are no longer needed. Their
     only job was to rebuild with a different level. `groupDefaultExpanded` now only seeds new
     nodes.
   - Update the `treeNodes` doc comment.
3. **Specs** in `data-table-tree.component.spec.ts`: expand a collapsed node, push a new `value`
   array that contains the same ids (a period change), and check the node is still expanded. Run
   collapse all, then push a new value, and check the nodes are still collapsed. Check the existing
   expand-all and collapse-all tests still pass.
4. **`docs/architecture.md`**: one sentence in the data-table paragraph: in tree mode, nodes are
   updated in place by row id, so expansion survives data changes.

The transactions feature itself needs no change. The category node ids (`c<id>`, `c-none`) stay the
same across periods.

## Race conditions

All updates are synchronous signal computations. PrimeNG mutates `node.expanded` on the same
objects that the next reconcile reuses, so there are no competing copies.

## Execution

| Step | Agent | Model/effort | Wave | Write set | Reads |
|---|---|---|---|---|---|
| 0 | main session | — | 0 | revert the finished expandedOverrides attempt: `git checkout --` the five data-table files + docs/architecture.md | — |
| 1–4 | implementer | sonnet / medium | 1 | data-table-tree.ts (+spec), data-table.component.ts/.html, data-table-tree.component.spec.ts, docs/architecture.md | angular-primeng-table skill |

Replace `docs/plans/20261004-tree-expansion-state-implementing.md` with this plan, keeping the same
file name.

## Verification

- From the repo root: `pnpm format:fix && pnpm format:check && pnpm lint && pnpm test && pnpm build`.
- In the browser: on `/de/transactions/categories`, expand a category, then press ▶/◀ and change
  accounts or search. The category stays expanded while it exists. Expand all and collapse all
  still work, and their state holds through the next period change. The Categories page behaves as
  before.

## Outcome (2026-10-04 21:30)

Done. The tree reconciles nodes by key, and expansion survives data changes. Gates pass: format,
lint, 28 backend + 310 frontend tests, and build (only the known bundle-budget warning). The
browser check is still to be done by the user.
