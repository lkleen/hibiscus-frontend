import { CdkMenu, CdkMenuItem, CdkMenuItemRadio, CdkMenuTrigger } from '@angular/cdk/menu';
import { ConnectedPosition } from '@angular/cdk/overlay';
import { ChangeDetectionStrategy, Component, computed, inject, type Signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Locale, SUPPORTED_LOCALES } from '../../models/locale.model';
import { SUPPORTED_THEMES, ThemeName } from '../../models/theme.model';
import { LocaleService } from '../../services/locale.service';
import { MeService } from '../../services/me.service';
import { ThemeService } from '../../services/theme.service';
import { TranslationService } from '../../services/translation.service';

/**
 * User identity trigger + menu, built on `@angular/cdk/menu` per frontend-angular-cdk.md (no
 * Angular Material menu to reach for in this repo). Theme and language are submenus of radio items.
 * The CDK menu stack owns focus, keyboard navigation, Escape/outside-click dismissal and the
 * menuitem* ARIA roles.
 */
@Component({
  selector: 'app-user-menu',
  templateUrl: './user-menu.component.html',
  styleUrl: './user-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CdkMenu, CdkMenuItem, CdkMenuItemRadio, CdkMenuTrigger, RouterLink],
})
export class UserMenuComponent {
  private readonly meService = inject(MeService);
  private readonly themeService = inject(ThemeService);
  private readonly localeService = inject(LocaleService);
  protected readonly i18n = inject(TranslationService);

  protected readonly user: Signal<string | null> = this.meService.user;
  protected readonly loadError: Signal<boolean> = this.meService.error;

  protected readonly theme = this.themeService.currentTheme;

  protected readonly locale = this.localeService.locale;

  protected readonly themeOptions: readonly ThemeName[] = SUPPORTED_THEMES;
  protected readonly localeOptions: readonly Locale[] = SUPPORTED_LOCALES;

  protected readonly ariaLabel = computed<string>(() => {
    const u = this.user();
    if (u) return this.i18n.t('userMenu.triggerLoggedIn', { user: u });
    if (this.loadError()) return this.i18n.t('userMenu.triggerError');
    return this.i18n.t('userMenu.triggerLoading');
  });

  /** The trigger sits at the trailing edge of the header, so the menu hangs from its end. */
  protected readonly panelPositions: ConnectedPosition[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
  ];

  /** Same reason: the flyout opens toward the viewport's interior first, then flips. */
  protected readonly submenuPositions: ConnectedPosition[] = [
    {
      originX: 'start',
      originY: 'top',
      overlayX: 'end',
      overlayY: 'top',
      offsetX: -2,
      offsetY: -4,
    },
    { originX: 'end', originY: 'top', overlayX: 'start', overlayY: 'top', offsetX: 2, offsetY: -4 },
  ];

  constructor() {
    // The route guards load it first; this covers pages that do not pass a guard.
    this.meService.load().subscribe({ error: () => undefined });
  }

  protected themeLabel(name: ThemeName): string {
    return this.i18n.t(`theme.${name}`);
  }

  protected localeLabel(locale: Locale): string {
    return this.i18n.t(`locale.${locale}`);
  }

  protected setTheme(name: ThemeName): void {
    this.themeService.setTheme(name);
  }

  protected setLocale(locale: Locale): void {
    this.localeService.setLocale(locale);
  }
}
