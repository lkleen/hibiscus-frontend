import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { installLocalStorageMock } from '../../utils/testing/local-storage-mock';
import { installMutationObserverMock } from '../../utils/testing/mutation-observer-mock';
import { HeaderComponent } from './header.component';

describe('HeaderComponent demo badge', () => {
  let fixture: ComponentFixture<HeaderComponent>;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    installLocalStorageMock();
    installMutationObserverMock();
    TestBed.configureTestingModule({
      imports: [HeaderComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(HeaderComponent);
    fixture.detectChanges();
  });

  function answerMe(dataSource: 'mariadb' | 'demo'): void {
    httpMock
      .expectOne('/api/me')
      .flush({ user: 'lars', database: 'configured', key: 'configured', dataSource });
    fixture.detectChanges();
  }

  afterEach(() => {
    fixture.destroy();
    httpMock.verify();
    vi.unstubAllGlobals();
  });

  function badge(): HTMLElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector('.header__demo');
  }

  it('is hidden on real data', () => {
    answerMe('mariadb');
    expect(badge()).toBeNull();
  });

  it('is shown as a status on demo data', () => {
    answerMe('demo');
    expect(badge()?.getAttribute('role')).toBe('status');
    expect(badge()?.textContent).toContain('Demo data');
  });
});
