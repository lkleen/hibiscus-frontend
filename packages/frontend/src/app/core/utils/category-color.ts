import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';

/**
 * Convert a Hibiscus category color to a CSS rgb() value.
 *
 * Hibiscus stores colors in two formats:
 *   - "r,g,b" (three integers 0–255, optional whitespace): converted to `rgb(r g b)`
 *   - "#rrggbb" (case-insensitive hex): passed through unchanged
 *
 * Returns null when `customcolor !== 1` or `color` is null (color not actively set).
 * Throws on invalid color strings (malformed, out-of-range, unknown format).
 *
 * @param row - A category row (or a partial with just `color` and `customcolor`)
 * @returns The CSS color string, or null if the color is not set
 * @throws Error if the color string is malformed or out of range
 */
export function toCssColor(row: Pick<CategoryRow, 'color' | 'customcolor'>): string | null {
  // Color is only active when customcolor === 1
  if (row.customcolor !== 1 || row.color === null) {
    return null;
  }

  const colorStr: string = row.color.trim();

  // Check for rgb format: "r,g,b" with optional whitespace
  const rgbMatch: RegExpMatchArray | null = colorStr.match(/^(\d+)\s*,\s*(\d+)\s*,\s*(\d+)$/);
  if (rgbMatch) {
    const r: number = parseInt(rgbMatch[1], 10);
    const g: number = parseInt(rgbMatch[2], 10);
    const b: number = parseInt(rgbMatch[3], 10);

    if (r > 255 || g > 255 || b > 255) {
      throw new Error(`Invalid RGB color value: "${row.color}" (component > 255)`);
    }

    return `rgb(${r} ${g} ${b})`;
  }

  // Check for hex format: "#rrggbb"
  if (colorStr.match(/^#[0-9a-fA-F]{6}$/)) {
    return colorStr;
  }

  // Unknown format
  throw new Error(`Invalid color format: "${row.color}" (expected "r,g,b" or "#rrggbb")`);
}
