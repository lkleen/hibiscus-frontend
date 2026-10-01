import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { DatePresetList } from '@hibiscus-frontend/shared/contracts/user-settings';
import { installMutationObserverMock } from '../../../core/utils/testing/mutation-observer-mock';
import { DateRange } from '../../../core/utils/date-range';
import { DateRangeFilterComponent } from './date-range-filter.component';

const URL = '/api/settings/date-presets';

const PRESETS: DatePresetList = [
  { id: 'a', name: 'Everything this year', kind: 'fixed', from: '2026-01-01', to: '2026-12-31' },
  { id: 'b', name: null, kind: 'relative', unit: 'month', offset: 0, count: 1 },
];

describe('DateRangeFilterComponent', () => {
  let fixture: ComponentFixture<DateRangeFilterComponent>;
  let httpMock: HttpTestingController;
  let root: HTMLElement;

  beforeEach(() => {
    installMutationObserverMock();
    TestBed.configureTestingModule({
      imports: [DateRangeFilterComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(DateRangeFilterComponent);
    root = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    fixture.destroy();
    httpMock.verify();
    vi.unstubAllGlobals();
  });

  async function loadPresets(presets: DatePresetList = PRESETS): Promise<void> {
    fixture.detectChanges();
    httpMock.expectOne(URL).flush(presets);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function trigger(): HTMLButtonElement {
    return root.querySelector<HTMLButtonElement>(
      '.date-range-filter__trigger',
    ) as HTMLButtonElement;
  }

  function input(which: 'from' | 'to'): HTMLInputElement {
    const inputs: NodeListOf<HTMLInputElement> = root.querySelectorAll('input[type="date"]');
    return inputs[which === 'from' ? 0 : 1];
  }

  async function openMenu(): Promise<HTMLButtonElement[]> {
    trigger().click();
    fixture.detectChanges();
    await fixture.whenStable();
    return Array.from(document.querySelectorAll<HTMLButtonElement>('.date-range-filter__item'));
  }

  function type(el: HTMLInputElement, value: string): void {
    el.value = value;
    el.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  it('applies the first preset once the presets have loaded', async () => {
    await loadPresets();
    expect(fixture.componentInstance.range()).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(trigger().textContent).toContain('Everything this year');
    expect(input('from').value).toBe('2026-01-01');
  });

  it('does not overwrite a range the parent set', async () => {
    const range: DateRange = { from: '2025-01-01', to: null };
    fixture.componentRef.setInput('range', range);
    await loadPresets();
    expect(fixture.componentInstance.range()).toEqual(range);
    expect(trigger().textContent).toContain('Custom range');
  });

  it('does not apply the first preset after the user interacted', async () => {
    fixture.detectChanges();
    type(input('from'), '2026-03-01');
    httpMock.expectOne(URL).flush(PRESETS);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.range()).toEqual({ from: '2026-03-01', to: null });
  });

  it('shows the dates each preset resolves to today in the menu', async () => {
    await loadPresets();
    const items: HTMLButtonElement[] = await openMenu();
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain('2026-01-01 – 2026-12-31');
    expect(items[1].textContent).toMatch(/\d{4}-\d{2}-01 – \d{4}-\d{2}-\d{2}/);
    expect(items[2].textContent).toContain('All dates');
  });

  it('sets the range when a preset is selected', async () => {
    await loadPresets();
    const items: HTMLButtonElement[] = await openMenu();
    items[1].click();
    fixture.detectChanges();
    const range: DateRange | null = fixture.componentInstance.range();
    expect(range?.from).toMatch(/-01$/);
    expect(trigger().textContent).toContain('Current month');
  });

  it('switches to a custom range when a date is edited and treats a cleared input as open', async () => {
    await loadPresets();
    type(input('to'), '');
    expect(fixture.componentInstance.range()).toEqual({ from: '2026-01-01', to: null });
    expect(trigger().textContent).toContain('Custom range');
    expect(input('from').max).toBe('');
  });

  it('sets the range to null for All dates', async () => {
    await loadPresets();
    const items: HTMLButtonElement[] = await openMenu();
    items[2].click();
    fixture.detectChanges();
    expect(fixture.componentInstance.range()).toBeNull();
    expect(trigger().textContent).toContain('All dates');
  });

  it('still offers All dates and shows an error when the presets failed to load', async () => {
    fixture.detectChanges();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    httpMock.expectOne(URL).flush(null, { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();
    fixture.detectChanges();
    const items: HTMLButtonElement[] = await openMenu();
    expect(items).toHaveLength(1);
    expect(document.querySelector('.date-range-filter__error')).not.toBeNull();
  });
});
