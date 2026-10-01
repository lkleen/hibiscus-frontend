import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { DatePreset } from '@hibiscus-frontend/shared/contracts/user-settings';
import { PresetEditorComponent } from './preset-editor.component';

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

describe('PresetEditorComponent', () => {
  let fixture: ComponentFixture<PresetEditorComponent>;
  let root: HTMLElement;
  let saved: DatePreset[];
  let cancelled: number;

  function create(preset: DatePreset, disabled = false): void {
    fixture = TestBed.createComponent(PresetEditorComponent);
    fixture.componentRef.setInput('preset', preset);
    fixture.componentRef.setInput('disabled', disabled);
    root = fixture.nativeElement as HTMLElement;
    fixture.componentInstance.saved.subscribe((value: DatePreset) => saved.push(value));
    fixture.componentInstance.cancelled.subscribe(() => cancelled++);
    fixture.detectChanges();
  }

  function click(selector: string): void {
    root.querySelector<HTMLElement>(selector)?.click();
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

  function saveDisabled(): boolean | undefined {
    return root.querySelector<HTMLButtonElement>('.editor__save')?.disabled;
  }

  beforeEach(() => {
    saved = [];
    cancelled = 0;
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  it('is prefilled from the preset', () => {
    create(holiday);
    expect(root.querySelector<HTMLInputElement>('#preset-name')?.value).toBe('Holiday');
    expect(root.querySelector<HTMLInputElement>('#preset-from')?.value).toBe('2025-12-20');
    expect(root.querySelector<HTMLInputElement>('#preset-to')?.value).toBe('2026-01-05');
  });

  it('emits the edited relative preset with a trimmed name', () => {
    create(month);
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
    expect(saved).toEqual([
      { id: 'a', name: 'Quarter', kind: 'relative', unit: 'quarter', offset: -1, count: 2 },
    ]);
  });

  it('emits the edited fixed preset', () => {
    create(holiday);
    setInput('#preset-to', '2026-01-10');
    click('.editor__save');
    expect(saved).toEqual([{ ...holiday, to: '2026-01-10' }]);
  });

  it('emits a null name and shows a generated placeholder when the name is empty', () => {
    create({ ...month, name: null });
    expect(root.querySelector('#preset-name')?.getAttribute('placeholder')).toBeTruthy();
    click('.editor__save');
    expect(saved[0]).toMatchObject({ id: 'a', name: null, kind: 'relative', unit: 'month' });
  });

  it('switches to a fixed preset', () => {
    create(month);
    click('input[value="fixed"]');
    setInput('#preset-from', '2024-01-01');
    setInput('#preset-to', '2024-03-31');
    click('.editor__save');
    expect(saved[0]).toMatchObject({ kind: 'fixed', from: '2024-01-01', to: '2024-03-31' });
  });

  it('disables save and explains why when the input is invalid', () => {
    create(holiday);
    setInput('#preset-from', '2026-02-01');
    setInput('#preset-to', '2026-01-01');
    expect(saveDisabled()).toBe(true);
    expect(root.querySelectorAll('.editor__error')).toHaveLength(1);

    click('input[value="relative"]');
    setInput('#preset-count', '0');
    expect(saveDisabled()).toBe(true);
    setInput('#preset-count', '367');
    expect(saveDisabled()).toBe(true);
    setInput('#preset-count', '3');
    expect(saveDisabled()).toBe(false);

    setInput('#preset-name', 'x'.repeat(81));
    expect(saveDisabled()).toBe(true);
    expect(saved).toEqual([]);
  });

  it('emits cancel', () => {
    create(month);
    click('.editor__cancel');
    expect(cancelled).toBe(1);
  });

  it('disables save and cancel while the parent is saving', () => {
    create(month, true);
    expect(saveDisabled()).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('.editor__cancel')?.disabled).toBe(true);
  });
});
