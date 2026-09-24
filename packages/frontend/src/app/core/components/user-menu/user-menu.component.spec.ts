import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ThemeService } from '../../services/theme.service';
import { installLocalStorageMock } from '../../utils/testing/local-storage-mock';
import { installMutationObserverMock } from '../../utils/testing/mutation-observer-mock';
import { UserMenuComponent } from './user-menu.component';

describe('UserMenuComponent', () => {
  let fixture: ComponentFixture<UserMenuComponent>;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    installLocalStorageMock();
    installMutationObserverMock();
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
    vi.unstubAllGlobals();
    document.documentElement.className = '';
  });

  function openPanel(): void {
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.user-menu__trigger')
      ?.click();
    fixture.detectChanges();
  }

  function openThemeSubmenu(): void {
    openPanel();
    document.querySelector<HTMLButtonElement>('.user-menu__theme-trigger')?.click();
    fixture.detectChanges();
  }

  function themeOptions(): HTMLButtonElement[] {
    return Array.from(document.querySelectorAll<HTMLButtonElement>('.user-menu__theme-option'));
  }

  it('shows the active theme on the Theme row and keeps the options out of the main menu', () => {
    openPanel();

    const trigger = document.querySelector<HTMLButtonElement>('.user-menu__theme-trigger');
    expect(trigger?.textContent).toContain('Theme');
    expect(trigger?.textContent).toContain('Default');
    expect(trigger?.getAttribute('aria-haspopup')).toBe('menu');
    expect(themeOptions().length).toBe(0);
  });

  it('opens a submenu with a radio option for every supported identity', () => {
    openThemeSubmenu();

    const options = themeOptions();
    expect(options.map((o) => o.textContent?.trim())).toEqual([
      'Default',
      'Greenbar',
      'Vault',
      'Private Ledger',
      'Telex',
    ]);
    expect(options.every((o) => o.getAttribute('role') === 'menuitemradio')).toBe(true);
    expect(options.map((o) => o.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'false',
      'false',
      'false',
    ]);
  });

  it('choosing a theme option switches the identity and closes the menu', () => {
    const themeService = TestBed.inject(ThemeService);
    openThemeSubmenu();

    themeOptions()
      .find((o) => o.textContent?.trim() === 'Vault')
      ?.click();
    fixture.detectChanges();

    expect(themeService.currentTheme()).toBe('vault');
    expect(themeOptions().length).toBe(0);

    openPanel();
    expect(
      document.querySelector('.user-menu__theme-trigger .user-menu__item-value')?.textContent,
    ).toBe('Vault');
  });
});
