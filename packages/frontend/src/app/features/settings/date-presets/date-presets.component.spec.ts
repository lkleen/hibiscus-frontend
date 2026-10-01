import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { DatePreset, DatePresetList } from '@hibiscus-frontend/shared/contracts/user-settings';
import { resolvePreset } from '../../../core/utils/date-range';
import { DatePresetsComponent } from './date-presets.component';

const URL = '/api/settings/date-presets';

const month: DatePreset = {
  id: 'a',
  name: 'Month',
  kind: 'relative',
  unit: 'month',
  offset: 0,
  count: 1,
};
const holiday: DatePreset = {
  id: 'b',
  name: 'Holiday',
  kind: 'fixed',
  from: '2025-12-20',
  to: '2026-01-05',
};
const lastYear: DatePreset = {
  id: 'c',
  name: null,
  kind: 'relative',
  unit: 'year',
  offset: -1,
  count: 1,
};

describe('DatePresetsComponent', () => {
  let fixture: ComponentFixture<DatePresetsComponent>;
  let httpMock: HttpTestingController;
  let root: HTMLElement;

  function noContent(req: TestRequest): void {
    req.flush(null, { status: 204, statusText: 'No Content' });
  }

  function texts(selector: string): string[] {
    return Array.from(root.querySelectorAll(selector)).map((el: Element) =>
      (el.textContent ?? '').trim(),
    );
  }

  function click(selector: string, index = 0): void {
    const el: HTMLElement | undefined = Array.from(root.querySelectorAll<HTMLElement>(selector))[
      index
    ];
    if (!el) throw new Error(`No element for ${selector}[${index}]`);
    el.click();
    fixture.detectChanges();
  }

  function setInput(selector: string, value: string): void {
    const input: HTMLInputElement = root.querySelector<HTMLInputElement>(
      selector,
    ) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function expectSaved(list: DatePresetList): TestRequest {
    const req: TestRequest = httpMock.expectOne(URL);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual(list);
    return req;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(DatePresetsComponent);
    root = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    httpMock.expectOne(URL).flush([month, holiday, lastYear]);
    fixture.detectChanges();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('renders labels and the dates each preset resolves to', () => {
    expect(texts('.presets__label')[0]).toContain('Month');
    expect(texts('.presets__label')[1]).toBe('Holiday');
    expect(texts('.presets__dates')[0]).toBe(
      `${resolvePreset(month, new Date()).from} – ${resolvePreset(month, new Date()).to}`,
    );
    expect(texts('.presets__dates')[1]).toBe('2025-12-20 – 2026-01-05');
    expect(texts('.presets__default')).toHaveLength(1);
  });

  it('moves a preset down and saves the new order', () => {
    click('.presets__item:nth-child(1) .presets__btn--icon', 1);
    expectSaved([holiday, month, lastYear]).flush(null, { status: 204, statusText: 'No Content' });
  });

  it('moves a preset up and saves the new order', () => {
    click('.presets__item:nth-child(3) .presets__btn--icon', 0);
    expectSaved([month, lastYear, holiday]);
  });

  it('disables the outermost move buttons', () => {
    const buttons: HTMLButtonElement[] = Array.from(
      root.querySelectorAll<HTMLButtonElement>('.presets__btn--icon'),
    );
    expect(buttons[0]?.disabled).toBe(true);
    expect(buttons[5]?.disabled).toBe(true);
  });

  it('deletes a preset', () => {
    click('.presets__delete', 1);
    expectSaved([month, lastYear]);
  });

  it('disables all actions while a save is in flight', () => {
    click('.presets__delete', 1);
    const req: TestRequest = expectSaved([month, lastYear]);
    expect(root.querySelector<HTMLButtonElement>('.presets__delete')?.disabled).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('.presets__add')?.disabled).toBe(true);
    noContent(req);
    fixture.detectChanges();
    expect(root.querySelector<HTMLButtonElement>('.presets__add')?.disabled).toBe(false);
  });

  it('edits a relative preset and saves it in place', () => {
    click('.presets__edit', 0);
    setInput('#preset-name', '  Quarter  ');
    const unit: HTMLSelectElement = root.querySelector<HTMLSelectElement>(
      '#preset-unit',
    ) as HTMLSelectElement;
    unit.value = 'quarter';
    unit.dispatchEvent(new Event('change'));
    setInput('#preset-count', '2');
    setInput('#preset-ago', '1');
    expect(root.querySelector('.editor__preview')).not.toBeNull();

    click('.editor__save');
    const req: TestRequest = expectSaved([
      { id: 'a', name: 'Quarter', kind: 'relative', unit: 'quarter', offset: -1, count: 2 },
      holiday,
      lastYear,
    ]);
    noContent(req);
    fixture.detectChanges();
    expect(root.querySelector('.editor')).toBeNull();
  });

  it('edits a fixed preset and saves it', () => {
    click('.presets__edit', 1);
    setInput('#preset-to', '2026-01-10');
    click('.editor__save');
    expectSaved([month, { ...holiday, to: '2026-01-10' }, lastYear]);
  });

  it('adds a relative preset with a generated name when the name is left empty', () => {
    click('.presets__add');
    const placeholder: string | null =
      root.querySelector<HTMLInputElement>('#preset-name')?.getAttribute('placeholder') ?? null;
    expect(placeholder).toBeTruthy();
    click('.editor__save');
    const req: TestRequest = httpMock.expectOne(URL);
    const body: DatePresetList = req.request.body as DatePresetList;
    expect(body).toHaveLength(4);
    expect(body[3]).toMatchObject({ name: null, kind: 'relative', unit: 'month', offset: 0 });
    expect(body[3]?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('adds a fixed preset', () => {
    click('.presets__add');
    const fixed: HTMLInputElement = root.querySelector<HTMLInputElement>(
      'input[value="fixed"]',
    ) as HTMLInputElement;
    fixed.click();
    fixture.detectChanges();
    setInput('#preset-from', '2024-01-01');
    setInput('#preset-to', '2024-03-31');
    setInput('#preset-name', 'Q1 2024');
    click('.editor__save');
    const body: DatePresetList = httpMock.expectOne(URL).request.body as DatePresetList;
    expect(body[3]).toMatchObject({
      name: 'Q1 2024',
      kind: 'fixed',
      from: '2024-01-01',
      to: '2024-03-31',
    });
  });

  it('keeps the editor open and shows the error when saving fails', () => {
    click('.presets__edit', 0);
    click('.editor__save');
    httpMock.expectOne(URL).flush('boom', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    expect(root.querySelector('.editor')).not.toBeNull();
    expect(root.querySelector('.presets__status--error')).not.toBeNull();
  });

  it('restores the defaults', () => {
    click('.presets__restore');
    const del: TestRequest = httpMock.expectOne(URL);
    expect(del.request.method).toBe('DELETE');
    noContent(del);
    httpMock.expectOne(URL).flush([month]);
    fixture.detectChanges();
    expect(texts('.presets__label')).toHaveLength(1);
  });
});
