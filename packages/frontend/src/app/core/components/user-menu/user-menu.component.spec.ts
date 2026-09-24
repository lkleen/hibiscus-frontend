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
    document.documentElement.className = 'theme-default';

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

  it('renders a theme option for every supported identity', () => {
    openPanel();

    const options = document.querySelectorAll<HTMLButtonElement>('.user-menu__theme-option');
    expect(options.length).toBe(5);
    expect(Array.from(options).map((o) => o.textContent?.trim())).toEqual([
      'Default',
      'Greenbar',
      'Vault',
      'Private Ledger',
      'Telex',
    ]);
  });

  it('clicking a theme option switches the active identity', () => {
    const themeService = TestBed.inject(ThemeService);
    openPanel();

    const options = document.querySelectorAll<HTMLButtonElement>('.user-menu__theme-option');
    const vaultOption = Array.from(options).find((o) => o.textContent?.trim() === 'Vault');
    vaultOption?.click();
    fixture.detectChanges();

    expect(themeService.currentTheme()).toBe('vault');
    expect(vaultOption?.getAttribute('aria-pressed')).toBe('true');
  });

  it('renders a dark-mode toggle labeled with the action for the current mode', () => {
    openPanel();

    const toggle = document.querySelector<HTMLButtonElement>('.user-menu__theme-toggle');
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute('aria-label')).toBe('Switch to dark mode');
    expect(toggle?.getAttribute('aria-pressed')).toBe('false');
  });

  it('clicking the toggle switches dark mode without changing the theme identity', () => {
    const themeService = TestBed.inject(ThemeService);
    openPanel();

    const toggle = document.querySelector<HTMLButtonElement>('.user-menu__theme-toggle');
    toggle?.click();
    fixture.detectChanges();

    expect(themeService.darkMode()).toBe(true);
    expect(themeService.currentTheme()).toBe('default');

    const toggleAfter = document.querySelector<HTMLButtonElement>('.user-menu__theme-toggle');
    expect(toggleAfter?.getAttribute('aria-label')).toBe('Switch to light mode');
    expect(toggleAfter?.getAttribute('aria-pressed')).toBe('true');
  });
});
