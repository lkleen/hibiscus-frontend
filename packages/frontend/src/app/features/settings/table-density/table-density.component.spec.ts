import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { TableDensity } from '@hibiscus-frontend/shared/contracts/user-settings';
import { TableDensityService, TABLE_DENSITIES } from '../../../core/services/table-density.service';
import { TableDensityComponent } from './table-density.component';

interface FakeService {
  density: WritableSignal<TableDensity>;
  loaded: WritableSignal<boolean>;
  loadError: WritableSignal<boolean>;
  saving: WritableSignal<boolean>;
  saveError: WritableSignal<boolean>;
  save: ReturnType<typeof vi.fn>;
}

describe('TableDensityComponent', () => {
  let fixture: ComponentFixture<TableDensityComponent>;
  let fake: FakeService;
  let root: HTMLElement;

  function radios(): HTMLInputElement[] {
    return Array.from(root.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
  }

  beforeEach(() => {
    fake = {
      density: signal<TableDensity>('normal'),
      loaded: signal<boolean>(true),
      loadError: signal<boolean>(false),
      saving: signal<boolean>(false),
      saveError: signal<boolean>(false),
      save: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: TableDensityService, useValue: fake }],
    });
    fixture = TestBed.createComponent(TableDensityComponent);
    root = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  it('renders one radio per density with the confirmed one checked', () => {
    expect(radios().length).toBe(5);
    expect(radios().map((r: HTMLInputElement) => r.value)).toEqual([...TABLE_DENSITIES]);
    expect(
      radios()
        .filter((r: HTMLInputElement) => r.checked)
        .map((r) => r.value),
    ).toEqual(['normal']);
  });

  it('saves the selected density', () => {
    const target: HTMLInputElement | undefined = radios()[4];
    if (!target) throw new Error('missing radio');
    target.click();
    fixture.detectChanges();
    expect(fake.save).toHaveBeenCalledWith('spacious');
  });

  it('disables the radios while saving and shows the status', () => {
    fake.saving.set(true);
    fixture.detectChanges();
    expect(radios().every((r: HTMLInputElement) => r.disabled)).toBe(true);
    expect(root.querySelector('[role="status"]')).not.toBeNull();
  });

  it('shows the load error instead of the picker', () => {
    fake.loadError.set(true);
    fixture.detectChanges();
    expect(root.querySelector('[role="alert"]')).not.toBeNull();
    expect(radios().length).toBe(0);
  });
});
