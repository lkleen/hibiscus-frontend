import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * A category's colour: a swatch plus the stored value. Hibiscus only shows a colour when
 * `customcolor = 1`, so a row without an active colour shows a dash and no swatch.
 */
@Component({
  selector: 'app-category-color-cell',
  templateUrl: './color-cell.component.html',
  styleUrl: './color-cell.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ColorCellComponent {
  /** The CSS colour (`toCssColor`), `null` when the row has no active custom colour. */
  readonly cssColor = input.required<string | null>();

  /** The colour exactly as stored (`"r,g,b"` or `"#rrggbb"`). */
  readonly stored = input.required<string | null>();
}
