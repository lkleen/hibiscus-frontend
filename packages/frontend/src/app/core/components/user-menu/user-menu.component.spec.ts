import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ThemeService } from '../../services/theme.service';
import { installLocalStorageMock } from '../../utils/testing/local-storage-mock';
import { UserMenuComponent } from './user-menu.component';

describe('UserMenuComponent', () => {
  let fixture: ComponentFixture<UserMenuComponent>;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    installLocalStorageMock();
    document.documentElement.className = 'theme-light';

    TestBed.configureTestingModule({
      imports: [UserMenuComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(UserMenuComponent);
    httpMock = TestBed.inject(HttpTestingController);

    fixture.detectChanges();
    httpMock.expectOne('/api/me').flush({ user: 'lars@kleen.email' });
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    httpMock.verify();
    document.documentElement.className = '';
  });

  function openPanel(): void {
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.user-menu__trigger')
      ?.click();
    fixture.detectChanges();
  }

  it('renders a Light and a Dark theme button with the current theme marked active', () => {
    openPanel();

    const buttons = document.querySelectorAll<HTMLButtonElement>('.user-menu__theme-option');
    expect(buttons.length).toBe(2);

    const labels = Array.from(buttons).map((b) => b.textContent?.trim());
    expect(labels).toEqual(['Light', 'Dark']);

    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    expect(buttons[1].getAttribute('aria-pressed')).toBe('false');
  });

  it('clicking the inactive theme button switches the active theme', () => {
    const themeService = TestBed.inject(ThemeService);
    openPanel();

    const buttons = document.querySelectorAll<HTMLButtonElement>('.user-menu__theme-option');
    buttons[1].click();
    fixture.detectChanges();

    expect(themeService.currentTheme()).toBe('dark');

    const buttonsAfter = document.querySelectorAll<HTMLButtonElement>('.user-menu__theme-option');
    expect(buttonsAfter[0].getAttribute('aria-pressed')).toBe('false');
    expect(buttonsAfter[1].getAttribute('aria-pressed')).toBe('true');
  });
});
