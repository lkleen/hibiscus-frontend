import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { TableViewId } from '@hibiscus-frontend/shared/contracts/user-settings';
import { DensityPickerComponent } from './density-picker.component';

@Component({
  imports: [DensityPickerComponent],
  template: `<app-density-picker [view]="view()" />`,
})
class HostComponent {
  readonly view = signal<TableViewId>('categories');
}

describe('DensityPickerComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let httpMock: HttpTestingController;

  function radios(): HTMLInputElement[] {
    const el: HTMLElement = fixture.nativeElement;
    return Array.from(el.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    httpMock.expectOne('/api/settings/table-densities').flush({ categories: 'compact' });
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('renders one radio per density in a labelled radiogroup', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBeTruthy();
    expect(radios().map((r: HTMLInputElement) => r.value)).toEqual([
      'extra-compact',
      'compact',
      'normal',
      'comfortable',
      'spacious',
    ]);
  });

  it('checks the current density of the view', () => {
    const checked: HTMLInputElement | undefined = radios().find((r: HTMLInputElement) => r.checked);
    expect(checked?.value).toBe('compact');
  });

  it('saves the chosen density for the view as the whole map', () => {
    const target: HTMLInputElement | undefined = radios().find(
      (r: HTMLInputElement) => r.value === 'spacious',
    );
    if (!target) throw new Error('spacious radio missing');
    target.click();

    const req = httpMock.expectOne('/api/settings/table-densities');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ categories: 'spacious' });
    req.flush(null, { status: 204, statusText: 'No Content' });
  });
});
