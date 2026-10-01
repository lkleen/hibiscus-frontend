import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { LocaleService } from '../../core/services/locale.service';
import { TranslationService } from '../../core/services/translation.service';
import { SETTINGS_TABS, SettingsTab } from './settings-tabs';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
})
export class SettingsComponent {
  protected readonly i18n = inject(TranslationService);
  protected readonly locale = inject(LocaleService).locale;
  protected readonly tabs: readonly SettingsTab[] = SETTINGS_TABS;
}
