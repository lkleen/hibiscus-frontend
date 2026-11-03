import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { KeyCreateComponent } from './key-create.component';

describe('KeyCreateComponent', () => {
  let fixture: ComponentFixture<KeyCreateComponent>;
  let httpMock: HttpTestingController;
  let revealing: boolean[];
  let exists: number;
  let created: number;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [KeyCreateComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(KeyCreateComponent);
    httpMock = TestBed.inject(HttpTestingController);
    fixture.componentRef.setInput('mode', 'stored');
    revealing = [];
    exists = 0;
    created = 0;
    fixture.componentInstance.revealing.subscribe((shown: boolean): void => {
      revealing.push(shown);
    });
    fixture.componentInstance.exists.subscribe((): void => {
      exists += 1;
    });
    fixture.componentInstance.created.subscribe((): void => {
      created += 1;
    });
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    httpMock.verify();
  });

  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function generate(): void {
    element().querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    fixture.detectChanges();
  }

  it('reports the generated key as on screen until the user confirms they saved it', () => {
    generate();
    httpMock.expectOne('/api/user/key').flush({ key: 'a'.repeat(44) });
    fixture.detectChanges();

    expect(revealing).toEqual([true]);
    expect(created).toBe(0);

    const saved: HTMLInputElement | null = element().querySelector('input[type="checkbox"]');
    if (saved === null) throw new Error('The "I saved it" checkbox is missing');
    saved.checked = true;
    saved.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    element().querySelector<HTMLButtonElement>('.app-form__button--primary')?.click();

    expect(revealing).toEqual([true, false]);
    expect(created).toBe(1);
  });

  it('emits exists when the backend already has a key, so setup can finish', () => {
    generate();
    httpMock
      .expectOne('/api/user/key')
      .flush({ error: 'key-configured' }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();

    expect(exists).toBe(1);
    expect(revealing).toEqual([]);
  });
});
