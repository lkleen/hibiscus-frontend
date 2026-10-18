import type { CategoryRow } from '@hibiscus-frontend/shared/contracts/categories';

type ParsedColor =
  | { readonly kind: 'rgb'; readonly r: number; readonly g: number; readonly b: number }
  | { readonly kind: 'hex'; readonly hex: string };

/** Parses either stored format; throws on malformed or out-of-range values. */
function parseColor(color: string): ParsedColor {
  const colorStr: string = color.trim();

  // rgb format: "r,g,b" with optional whitespace
  const rgbMatch: RegExpMatchArray | null = colorStr.match(/^(\d+)\s*,\s*(\d+)\s*,\s*(\d+)$/);
  if (rgbMatch) {
    const r: number = parseInt(rgbMatch[1], 10);
    const g: number = parseInt(rgbMatch[2], 10);
    const b: number = parseInt(rgbMatch[3], 10);
    if (r > 255 || g > 255 || b > 255) {
      throw new Error(`Invalid RGB color value: "${color}" (component > 255)`);
    }
    return { kind: 'rgb', r, g, b };
  }

  // hex format: "#rrggbb"
  if (colorStr.match(/^#[0-9a-fA-F]{6}$/)) {
    return { kind: 'hex', hex: colorStr };
  }

  throw new Error(`Invalid color format: "${color}" (expected "r,g,b" or "#rrggbb")`);
}

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

  const parsed: ParsedColor = parseColor(row.color);
  return parsed.kind === 'rgb' ? `rgb(${parsed.r} ${parsed.g} ${parsed.b})` : parsed.hex;
}

/** `#rrggbb` (from `<input type="color">`) → Hibiscus's stored `"r,g,b"`; throws on anything else. */
export function toStoredColor(hex: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
    throw new Error(`Invalid color format: "${hex}" (expected "#rrggbb")`);
  }
  const channels: string[] = [1, 3, 5].map((start: number) =>
    String(parseInt(hex.slice(start, start + 2), 16)),
  );
  return channels.join(',');
}

/** The stored colour (either format) as `#rrggbb` for `<input type="color">`, or null when `color` is null; ignores `customcolor`; throws on malformed. */
export function toHexColor(color: string | null): string | null {
  if (color === null) return null;
  const parsed: ParsedColor = parseColor(color);
  if (parsed.kind === 'hex') return parsed.hex.toLowerCase();
  const hex: string = [parsed.r, parsed.g, parsed.b]
    .map((channel: number) => channel.toString(16).padStart(2, '0'))
    .join('');
  return `#${hex}`;
}
