import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MeService } from '../../../core/services/me.service';
import { DatabaseTabComponent } from './database-tab.component';

describe('DatabaseTabComponent', () => {
  const isDemo: WritableSignal<boolean> = signal(false);
  let fixture: ComponentFixture<DatabaseTabComponent>;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [DatabaseTabComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MeService, useValue: { isDemo } },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(DatabaseTabComponent);
  });

  it('shows the form on real data', () => {
    isDemo.set(false);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.database-tab__hint')).not.toBeNull();
    expect(el.querySelector('app-database-form')).not.toBeNull();
    expect(el.querySelector('.app-form__notice')).toBeNull();
    httpMock.match(() => true);
  });

  it('shows only the notice, without the form, on demo data', () => {
    isDemo.set(true);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.app-form__notice')?.textContent).toContain('sample data');
    expect(el.querySelector('app-database-form')).toBeNull();
    httpMock.verify();
  });
});
