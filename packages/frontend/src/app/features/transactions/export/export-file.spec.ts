import { downloadBlob, exportFileName } from './export-file';

describe('exportFileName', () => {
  it('names the file after view, range and format', () => {
    expect(
      exportFileName({
        view: 'transactions-by-category',
        range: { from: '2026-01-01', to: '2026-09-30' },
        format: 'pdf',
      }),
    ).toBe('transactions-by-category_2026-01-01_2026-09-30.pdf');
    expect(
      exportFileName({
        view: 'transactions-list',
        range: { from: '2026-01-01', to: '2026-09-30' },
        format: 'csv',
      }),
    ).toBe('transactions-list_2026-01-01_2026-09-30.csv');
  });

  it('marks an open end', () => {
    expect(
      exportFileName({
        view: 'transactions-list',
        range: { from: '2026-01-01', to: null },
        format: 'json',
      }),
    ).toBe('transactions-list_2026-01-01_open.json');
    expect(
      exportFileName({
        view: 'transactions-list',
        range: { from: null, to: '2026-02-01' },
        format: 'json',
      }),
    ).toBe('transactions-list_open_2026-02-01.json');
  });

  it('uses all-dates for a null or fully open range', () => {
    expect(exportFileName({ view: 'transactions-list', range: null, format: 'csv' })).toBe(
      'transactions-list_all-dates.csv',
    );
    expect(
      exportFileName({ view: 'transactions-list', range: { from: null, to: null }, format: 'csv' }),
    ).toBe('transactions-list_all-dates.csv');
  });
});

describe('downloadBlob', () => {
  it('clicks a temporary link and revokes the object URL', () => {
    const create = vi.fn((): string => 'blob:x');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const seen: { download: string; href: string; attached: boolean }[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation((): void => {
      const link: HTMLAnchorElement | null = document.body.querySelector('a[download]');
      if (link === null) throw new Error('link not attached');
      seen.push({ download: link.download, href: link.getAttribute('href') ?? '', attached: true });
    });

    downloadBlob(new Blob(['x']), 'a.csv');

    expect(click).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([{ download: 'a.csv', href: 'blob:x', attached: true }]);
    expect(document.body.querySelector('a[download]')).toBeNull();
    expect(revoke).toHaveBeenCalledWith('blob:x');
    click.mockRestore();
  });
});
