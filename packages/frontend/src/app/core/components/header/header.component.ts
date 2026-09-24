import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslationKey } from '../../models/translation.model';
import { LocaleService } from '../../services/locale.service';
import { TranslationService } from '../../services/translation.service';
import { DarkModeToggleComponent } from '../dark-mode-toggle/dark-mode-toggle.component';
import { UserMenuComponent } from '../user-menu/user-menu.component';

interface NavLink {
  path: string;
  labelKey: TranslationKey;
}

@Component({
  selector: 'app-header',
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, DarkModeToggleComponent, UserMenuComponent],
})
export class HeaderComponent {
  protected readonly i18n = inject(TranslationService);
  protected readonly locale = inject(LocaleService).locale;

  protected readonly navLinks: readonly NavLink[] = [
    { path: 'accounts', labelKey: 'nav.accounts' },
    { path: 'transactions', labelKey: 'nav.transactions' },
    { path: 'categories', labelKey: 'nav.categories' },
    { path: 'payees', labelKey: 'nav.payees' },
  ];
}
