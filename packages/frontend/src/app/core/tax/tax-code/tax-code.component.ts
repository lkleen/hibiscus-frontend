import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * A tax tag (`St-VA`, `St-0`, …), set as a small code stamp. An
 * inherited tag (from a parent category) is drawn outlined and muted.
 */
@Component({
  selector: 'app-tax-code',
  templateUrl: './tax-code.component.html',
  styleUrl: './tax-code.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.tax-code--inherited]': 'inherited()' },
})
export class TaxCodeComponent {
  readonly code = input.required<string>();
  readonly inherited = input<boolean>(false);
}
