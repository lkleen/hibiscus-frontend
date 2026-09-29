import { defaultFilterValueGetter, defaultValueGetter } from './data-table.defaults';
import type { DataTableColDef, DataTableFilterType } from './data-table.model';

/**
 * Why this file exists — the one place PrimeNG 21 internals are relied on (pinned; re-verify
 * against `node_modules/primeng/fesm2022/primeng-table.mjs` before touching this on an upgrade):
 *
 * `<p-table>`'s column filters (`p-columnFilter`) read a row's filtered value as `row[key]`,
 * where `key` is the filter map's key — always a plain string, never a function
 * (`Table.executeLocalFilter` → `ObjectUtils.resolveFieldData(rowData, field)`, and
 * `resolveFieldData` only calls `field` when it *is* a function; a filter's `field` is always the
 * string passed to `[field]` on `<p-columnFilter>`). That is the one lookup in the whole
 * PrimeNG-facing surface that cannot be handed a lambda — sorting gets `customSort`/
 * `sortFunction`, the global filter's `globalFilterFields` entries are called if they're
 * functions (`resolveFieldData` again) — so both of those call the column's lambdas directly.
 * Column filters have no such hook.
 *
 * The column-accessor proxy closes that gap: `<p-table>` is bound to one read-only `Proxy` per
 * raw row (cached in a `WeakMap`, so row object identity — and therefore PrimeNG's `filteredValue`
 * and paging — survives). Its `get` trap answers a filterable column's `colId` with that column's
 * `filterValueGetter(raw)` instead of the proxy's own (nonexistent) property; every other key
 * forwards to the raw row via `Reflect.get`. `set`/`defineProperty`/`deleteProperty` all throw —
 * PrimeNG's filtering is read-only from its own perspective, and the raw row must only ever be
 * mutated by the feature that owns it (e.g. a category change), never by the table.
 *
 * Cell templates and every column lambda (`valueGetter`, `comparator`, …) are always called with
 * the *raw* row, via `getRawRow()` below — never with the proxy itself. The proxy is a PrimeNG
 * input adapter, not a row representation.
 *
 * A `colId` that happens to equal a real field name on the raw row (e.g. a column `colId: 'datum'`
 * on a row that also has a `datum` field) is fine, not a bug: for `filter: 'text'`/`'numeric'`
 * columns, the default `filterValueGetter` is `defaultFilterValueGetter(type, valueGetter(row))`,
 * and the default `valueGetter` for such a column is `row[colId]` — i.e. the *same* value
 * `Reflect.get` would have returned anyway. Only `filter: 'date'` actually changes what the proxy
 * answers (an ISO string becomes a `Date`), which is the one case that needs the proxy at all.
 *
 * `dataKey`/row identity: this component does not bind `p-table`'s `dataKey` input at all, so the
 * question "does a filterable colId collide with dataKey" does not arise here. Row identity for
 * `<p-table>`'s internal `*ngFor` instead goes through `rowTrackBy`, computed from
 * `options().getRowId` on the *raw* row (see `data-table.component.ts`) — a colId can never rewrite
 * that, because `rowTrackBy` never reads a row through this proxy in the first place.
 */
const RAW_ROW: unique symbol = Symbol('data-table-raw-row');

export interface ColumnAccessorProxyFactory<Row extends object> {
  /** Returns the cached proxy for `raw`, creating and caching one on first call. */
  getProxy(raw: Row): Row;
}

/**
 * `getColumns` is called on every proxy property access (not just once at construction), so a
 * column definition added/removed/changed later (e.g. lookups finishing loading) is honoured
 * immediately — nothing needs to be rebuilt.
 */
export function createColumnAccessorProxyFactory<Row extends object>(
  getColumns: () => readonly DataTableColDef<Row, unknown>[],
): ColumnAccessorProxyFactory<Row> {
  const cache = new WeakMap<Row, Row>();

  function findFilterableColumn(colId: string): DataTableColDef<Row, unknown> | undefined {
    return getColumns().find((column) => column.colId === colId && column.filter !== false);
  }

  function resolveFilterValueGetter(column: DataTableColDef<Row, unknown>): (row: Row) => unknown {
    if (column.filterValueGetter) return column.filterValueGetter;
    const valueGetter = column.valueGetter ?? defaultValueGetter<Row>(column.colId);
    const filterType: DataTableFilterType =
      column.filter === false ? 'text' : (column.filter ?? 'text');
    return (row: Row): unknown => defaultFilterValueGetter(filterType, valueGetter(row));
  }

  return {
    getProxy(raw: Row): Row {
      const cached = cache.get(raw);
      if (cached) return cached;

      const proxy = new Proxy(raw, {
        get(target, prop, receiver) {
          if (prop === RAW_ROW) return raw;
          if (typeof prop === 'string') {
            const column = findFilterableColumn(prop);
            if (column) return resolveFilterValueGetter(column)(raw);
          }
          return Reflect.get(target, prop, receiver);
        },
        set(): boolean {
          throw new Error(
            'data-table: rows are read-only through the column-accessor proxy — mutate the raw row instead',
          );
        },
        defineProperty(): boolean {
          throw new Error(
            'data-table: rows are read-only through the column-accessor proxy — mutate the raw row instead',
          );
        },
        deleteProperty(): boolean {
          throw new Error(
            'data-table: rows are read-only through the column-accessor proxy — mutate the raw row instead',
          );
        },
      });
      cache.set(raw, proxy);
      return proxy;
    },
  };
}

/**
 * Unwraps a column-accessor proxy back to the raw row it wraps. Given a row that was never
 * proxied (e.g. already raw), returns it unchanged — so callers can use this defensively on any
 * `Row`-typed value without knowing whether it came through the proxy.
 */
export function getRawRow<Row>(row: Row): Row {
  const raw = (row as Record<PropertyKey, unknown>)[RAW_ROW];
  return raw === undefined ? row : (raw as Row);
}
