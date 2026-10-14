declare module '@pdf-lib/fontkit' {
  export interface Glyph {
    id: number;
    advanceWidth: number;
    codePoints: number[];
  }
  export interface GlyphRun {
    glyphs: Glyph[];
    direction: 'ltr' | 'rtl';
  }
  export interface Font {
    postscriptName: string;
    unitsPerEm: number;
    ascent: number;
    descent: number;
    layout(text: string, features?: Record<string, boolean> | string[]): GlyphRun;
    hasGlyphForCodePoint(codePoint: number): boolean;
  }
  const fontkit: { create(buffer: Uint8Array): Font };
  export default fontkit;
}
