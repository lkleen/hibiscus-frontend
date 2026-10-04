import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslationKey } from '../../../core/models/translation.model';
import { TranslationService } from '../../../core/services/translation.service';

export interface TabNavItem {
  /** Route segment appended to `basePath`. */
  readonly path: string;
  readonly labelKey: TranslationKey;
}

/** A row of route links on a hairline; the active tab carries an accent underline. */
@Component({
  selector: 'app-tab-nav',
  templateUrl: './tab-nav.component.html',
  styleUrl: './tab-nav.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
})
export class TabNavComponent {
  protected readonly i18n = inject(TranslationService);

  readonly tabs = input.required<readonly TabNavItem[]>();
  /** Link prefix, e.g. `['/', locale, 'settings']`; each link is `[...basePath, tab.path]`. */
  readonly basePath = input.required<readonly string[]>();
  readonly ariaLabelKey = input.required<TranslationKey>();
}
