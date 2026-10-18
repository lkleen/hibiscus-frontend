import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { TranslationKey } from '../../../core/models/translation.model';
import { TranslationService } from '../../../core/services/translation.service';

/** A set of related controls with a caption below, separated from its neighbours by a hairline. */
@Component({
  selector: 'app-ribbon-group',
  template: `
    <div class="ribbon-group__body"><ng-content /></div>
    <span class="ribbon-group__caption">{{ i18n.t(captionKey()) }}</span>
  `,
  styleUrl: './ribbon-group.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.ribbon-group--grow]': 'grow()' },
})
export class RibbonGroupComponent {
  protected readonly i18n: TranslationService = inject(TranslationService);

  readonly captionKey = input.required<TranslationKey>();
  /** Let the group take free width in the band row. */
  readonly grow = input<boolean>(false);
}
