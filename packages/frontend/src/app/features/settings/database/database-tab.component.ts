import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslationService } from '../../../core/services/translation.service';
import { DatabaseFormComponent } from '../../setup/database-form/database-form.component';

/** Settings tab: the connection to the user's own Hibiscus database. */
@Component({
  selector: 'app-database-tab',
  templateUrl: './database-tab.component.html',
  styleUrl: './database-tab.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatabaseFormComponent],
})
export class DatabaseTabComponent {
  protected readonly i18n = inject(TranslationService);
}
