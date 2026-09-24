import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ThemeService } from '../../services/theme.service';
import { TranslationService } from '../../services/translation.service';

/** Light/dark axis switch, independent of the theme identity (see ThemeService). */
@Component({
  selector: 'app-dark-mode-toggle',
  templateUrl: './dark-mode-toggle.component.html',
  styleUrl: './dark-mode-toggle.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DarkModeToggleComponent {
  private readonly themeService = inject(ThemeService);
  private readonly i18n = inject(TranslationService);

  protected readonly darkMode = this.themeService.darkMode;

  protected readonly label = computed<string>(() =>
    this.i18n.t(this.darkMode() ? 'darkMode.switchToLight' : 'darkMode.switchToDark'),
  );

  protected toggle(): void {
    this.themeService.toggleDarkMode();
  }
}
