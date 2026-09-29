import { createColumnAccessorProxyFactory, getRawRow } from './column-accessor-proxy';
import type { DataTableColDef } from './data-table.model';

interface Row {
  readonly id: number;
  readonly datum: string;
  readonly amount: number;
  category: string | null;
}

function row(overrides: Partial<Row> = {}): Row {
  return { id: 1, datum: '2026-01-15', amount: 5, category: null, ...overrides };
}

describe('createColumnAccessorProxyFactory', () => {
  it('forwards a non-filter key to the raw row', () => {
    const columns: DataTableColDef<Row, unknown>[] = [
      { colId: 'id', headerKey: 'table.pageReport' },
    ];
    const factory = createColumnAccessorProxyFactory<Row>(() => columns);
    const raw = row({ id: 42 });

    expect(factory.getProxy(raw).id).toBe(42);
  });

  it("answers a filterable column's colId with its filterValueGetter", () => {
    const columns: DataTableColDef<Row, unknown>[] = [
      {
        colId: 'category',
        headerKey: 'table.pageReport',
        filterValueGetter: (r) => `filtered:${r.category ?? 'none'}`,
      },
    ];
    const factory = createColumnAccessorProxyFactory<Row>(() => columns);
    const raw = row({ category: 'Groceries' });
    const proxy = factory.getProxy(raw) as unknown as Record<string, unknown>;

    expect(proxy['category']).toBe('filtered:Groceries');
  });

  it("defaults a date filter's value to a parsed Date, not the raw ISO string", () => {
    const columns: DataTableColDef<Row, unknown>[] = [
      { colId: 'datum', headerKey: 'table.pageReport', filter: 'date' },
    ];
    const factory = createColumnAccessorProxyFactory<Row>(() => columns);
    const raw = row({ datum: '2026-03-15' });
    const proxy = factory.getProxy(raw) as unknown as Record<string, unknown>;

    const value = proxy['datum'];
    expect(value).toBeInstanceOf(Date);
    expect((value as Date).getFullYear()).toBe(2026);
    expect((value as Date).getMonth()).toBe(2);
    expect((value as Date).getDate()).toBe(15);
  });

  it('defaults a text/numeric filter to the same value Reflect.get would answer', () => {
    const columns: DataTableColDef<Row, unknown>[] = [
      { colId: 'amount', headerKey: 'table.pageReport', filter: 'numeric' },
    ];
    const factory = createColumnAccessorProxyFactory<Row>(() => columns);
    const raw = row({ amount: 123.45 });
    const proxy = factory.getProxy(raw) as unknown as Record<string, unknown>;

    expect(proxy['amount']).toBe(123.45);
  });

  it('does not intercept a colId whose column has filter: false', () => {
    const columns: DataTableColDef<Row, unknown>[] = [
      {
        colId: 'category',
        headerKey: 'table.pageReport',
        filter: false,
        valueGetter: () => 'computed',
      },
    ];
    const factory = createColumnAccessorProxyFactory<Row>(() => columns);
    const raw = row({ category: 'raw-value' });
    const proxy = factory.getProxy(raw) as unknown as Record<string, unknown>;

    // filter: false means the column never answers this key through the proxy — the raw field
    // passes through untouched, regardless of what valueGetter would have computed for display.
    expect(proxy['category']).toBe('raw-value');
  });

  it('caches one proxy per raw row, so identity is stable across repeated calls', () => {
    const columns: DataTableColDef<Row, unknown>[] = [];
    const factory = createColumnAccessorProxyFactory<Row>(() => columns);
    const raw = row();

    expect(factory.getProxy(raw)).toBe(factory.getProxy(raw));
  });

  it('reads columns live, so a column added after the first proxy is still honoured', () => {
    let columns: DataTableColDef<Row, unknown>[] = [];
    const factory = createColumnAccessorProxyFactory<Row>(() => columns);
    const raw = row({ category: 'Groceries' });
    const proxy = factory.getProxy(raw) as unknown as Record<string, unknown>;

    expect(proxy['category']).toBe('Groceries');

    columns = [
      { colId: 'category', headerKey: 'table.pageReport', filterValueGetter: () => 'now-filtered' },
    ];
    expect(proxy['category']).toBe('now-filtered');
  });

  it('throws on set, defineProperty and deleteProperty', () => {
    const factory = createColumnAccessorProxyFactory<Row>(() => []);
    const proxy = factory.getProxy(row()) as unknown as Record<string, unknown>;

    expect(() => {
      proxy['category'] = 'nope';
    }).toThrow();
    expect(() => {
      Object.defineProperty(proxy, 'category', { value: 'nope' });
    }).toThrow();
    expect(() => {
      delete proxy['category'];
    }).toThrow();
  });
});

describe('getRawRow', () => {
  it('unwraps a proxy back to the exact raw row object', () => {
    const factory = createColumnAccessorProxyFactory<Row>(() => []);
    const raw = row();

    expect(getRawRow(factory.getProxy(raw))).toBe(raw);
  });

  it('returns a plain (never-proxied) row unchanged', () => {
    const raw = row();

    expect(getRawRow(raw)).toBe(raw);
  });
});
