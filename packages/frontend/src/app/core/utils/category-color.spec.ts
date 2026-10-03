import { toCssColor } from './category-color';

describe('toCssColor', () => {
  it('returns null when customcolor is 0', () => {
    expect(toCssColor({ color: '255,0,0', customcolor: 0 })).toBe(null);
  });

  it('returns null when customcolor is null', () => {
    expect(toCssColor({ color: '255,0,0', customcolor: null })).toBe(null);
  });

  it('returns null when color is null', () => {
    expect(toCssColor({ color: null, customcolor: 1 })).toBe(null);
  });

  it('converts "r,g,b" format to rgb(r g b)', () => {
    expect(toCssColor({ color: '255,0,0', customcolor: 1 })).toBe('rgb(255 0 0)');
    expect(toCssColor({ color: '0,255,0', customcolor: 1 })).toBe('rgb(0 255 0)');
    expect(toCssColor({ color: '0,0,255', customcolor: 1 })).toBe('rgb(0 0 255)');
  });

  it('handles whitespace in "r,g,b" format', () => {
    expect(toCssColor({ color: ' 12, 34 ,56 ', customcolor: 1 })).toBe('rgb(12 34 56)');
    expect(toCssColor({ color: '12 , 34 , 56', customcolor: 1 })).toBe('rgb(12 34 56)');
  });

  it('passes through hex "#rrggbb" format unchanged', () => {
    expect(toCssColor({ color: '#A1b2C3', customcolor: 1 })).toBe('#A1b2C3');
    expect(toCssColor({ color: '#000000', customcolor: 1 })).toBe('#000000');
    expect(toCssColor({ color: '#ffffff', customcolor: 1 })).toBe('#ffffff');
  });

  it('throws on RGB component > 255', () => {
    expect(() => toCssColor({ color: '300,0,0', customcolor: 1 })).toThrow(
      /Invalid RGB color value.*> 255/,
    );
    expect(() => toCssColor({ color: '0,256,0', customcolor: 1 })).toThrow(
      /Invalid RGB color value.*> 255/,
    );
  });

  it('throws on malformed "r,g,b" (missing component)', () => {
    expect(() => toCssColor({ color: '1,2', customcolor: 1 })).toThrow(/Invalid color format/);
  });

  it('throws on unknown color format', () => {
    expect(() => toCssColor({ color: 'red', customcolor: 1 })).toThrow(/Invalid color format/);
  });
});
