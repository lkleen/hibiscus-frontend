import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ThemeService } from '../../services/theme.service';
import { installLocalStorageMock } from '../../utils/testing/local-storage-mock';
import { DarkModeToggleComponent } from './dark-mode-toggle.component';

describe('DarkModeToggleComponent', () => {
  let fixture: ComponentFixture<DarkModeToggleComponent>;

  beforeEach(() => {
    installLocalStorageMock();
    document.documentElement.className = 'theme-default';

    TestBed.configureTestingModule({ imports: [DarkModeToggleComponent] });
    fixture = TestBed.createComponent(DarkModeToggleComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    document.documentElement.className = '';
  });

  function button(): HTMLButtonElement {
    const el: HTMLButtonElement | null = (fixture.nativeElement as HTMLElement).querySelector(
      '.dark-mode-toggle',
    );
    if (!el) throw new Error('dark mode toggle button not rendered');
    return el;
  }

  it('is labeled with the action for the current mode', () => {
    expect(button().getAttribute('aria-label')).toBe('Switch to dark mode');
    expect(button().getAttribute('aria-pressed')).toBe('false');
  });

  it('switches dark mode without changing the theme identity', () => {
    const themeService = TestBed.inject(ThemeService);

    button().click();
    fixture.detectChanges();

    expect(themeService.darkMode()).toBe(true);
    expect(themeService.currentTheme()).toBe('default');
    expect(button().getAttribute('aria-label')).toBe('Switch to light mode');
    expect(button().getAttribute('aria-pressed')).toBe('true');
  });
});
