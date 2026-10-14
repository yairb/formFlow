import fontkit, { type Font } from '@pdf-lib/fontkit';
import { DOC_TEXT_FEATURES } from './metrics';

export type DocFontFamily = 'sans' | 'serif';

export type FontKey =
  | 'sans-regular'
  | 'sans-bold'
  | 'sans-hebrew-regular'
  | 'sans-hebrew-bold'
  | 'serif-regular'
  | 'serif-hebrew-regular';

/** File names inside src/assets/fonts. */
export const FONT_FILES: Record<FontKey, string> = {
  'sans-regular': 'NotoSans-Regular.ttf',
  'sans-bold': 'NotoSans-Bold.ttf',
  'sans-hebrew-regular': 'NotoSansHebrew-Regular.ttf',
  'sans-hebrew-bold': 'NotoSansHebrew-Bold.ttf',
  'serif-regular': 'NotoSerif-Regular.ttf',
  'serif-hebrew-regular': 'NotoSerifHebrew-Regular.ttf',
};

export const FONT_FAMILIES: { id: DocFontFamily; label: string; css: string; supportsBold: boolean }[] =
  [
    { id: 'sans', label: 'Sans', css: "'FF Doc Sans'", supportsBold: true },
    { id: 'serif', label: 'Serif', css: "'FF Doc Serif'", supportsBold: false },
  ];

export function familyCss(family: DocFontFamily): string {
  return FONT_FAMILIES.find((f) => f.id === family)?.css ?? "'FF Doc Sans'";
}

export function familySupportsBold(family: DocFontFamily): boolean {
  return FONT_FAMILIES.find((f) => f.id === family)?.supportsBold ?? false;
}

export type ScriptClass = 'hebrew' | 'base';

export function isHebrewCodeUnit(code: number): boolean {
  return (code >= 0x0590 && code <= 0x05ff) || (code >= 0xfb1d && code <= 0xfb4f);
}

export function faceFor(family: DocFontFamily, bold: boolean, script: ScriptClass): FontKey {
  const b = bold && familySupportsBold(family);
  if (family === 'serif') return script === 'hebrew' ? 'serif-hebrew-regular' : 'serif-regular';
  if (script === 'hebrew') return b ? 'sans-hebrew-bold' : 'sans-hebrew-regular';
  return b ? 'sans-bold' : 'sans-regular';
}

export interface FontRun {
  text: string;
  face: FontKey;
  script: ScriptClass;
}

/** Splits text into runs that are each drawn with a single font face. */
export function splitFontRuns(text: string, family: DocFontFamily, bold: boolean): FontRun[] {
  const runs: FontRun[] = [];
  let current: FontRun | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const script: ScriptClass = isHebrewCodeUnit(ch.charCodeAt(0)) ? 'hebrew' : 'base';
    if (current && current.script === script) {
      current.text += ch;
    } else {
      current = { text: ch, face: faceFor(family, bold, script), script };
      runs.push(current);
    }
  }
  return runs;
}

/**
 * Holds the parsed document fonts. One instance is shared by text layout (editor)
 * and export, which guarantees both measure text with identical glyph advances.
 */
export class FontLibrary {
  private fonts = new Map<FontKey, Font>();
  private bytes = new Map<FontKey, Uint8Array>();
  private widthCache = new Map<string, number>();

  constructor(entries: Iterable<[FontKey, Uint8Array]>) {
    for (const [key, data] of entries) {
      this.bytes.set(key, data);
      this.fonts.set(key, fontkit.create(data));
    }
  }

  getBytes(key: FontKey): Uint8Array {
    const b = this.bytes.get(key);
    if (!b) throw new Error(`Font ${key} is not loaded`);
    return b;
  }

  getFont(key: FontKey): Font {
    const f = this.fonts.get(key);
    if (!f) throw new Error(`Font ${key} is not loaded`);
    return f;
  }

  /** Width in points of a single-face run (glyph advances, no kerning). */
  runWidth(text: string, face: FontKey, size: number): number {
    if (!text) return 0;
    const cacheKey = `${face}\u0000${text}`;
    let units = this.widthCache.get(cacheKey);
    if (units === undefined) {
      const font = this.getFont(face);
      const run = font.layout(text, DOC_TEXT_FEATURES);
      let total = 0;
      for (const g of run.glyphs) total += g.advanceWidth;
      units = total / font.unitsPerEm;
      if (this.widthCache.size > 20000) this.widthCache.clear();
      this.widthCache.set(cacheKey, units);
    }
    return units * size;
  }

  measure(text: string, family: DocFontFamily, bold: boolean, size: number): number {
    let w = 0;
    for (const run of splitFontRuns(text, family, bold)) w += this.runWidth(run.text, run.face, size);
    return w;
  }

  /** Characters the document fonts cannot draw (they would export as empty boxes). */
  unsupportedCharacters(text: string, family: DocFontFamily, bold: boolean): string[] {
    const missing = new Set<string>();
    for (const run of splitFontRuns(text, family, bold)) {
      const font = this.getFont(run.face);
      for (const ch of run.text) {
        const cp = ch.codePointAt(0)!;
        if (cp === 0x0a || cp === 0x0d || cp === 0x09) continue;
        if (!font.hasGlyphForCodePoint(cp)) missing.add(ch);
      }
    }
    return [...missing];
  }
}

let shared: FontLibrary | null = null;

export function setSharedFontLibrary(lib: FontLibrary): void {
  shared = lib;
}

export function getSharedFontLibrary(): FontLibrary {
  if (!shared) throw new Error('Document fonts have not been loaded yet');
  return shared;
}

export function hasSharedFontLibrary(): boolean {
  return shared !== null;
}

export async function loadFontLibrary(
  read: (fileName: string) => Promise<Uint8Array>,
): Promise<FontLibrary> {
  const keys = Object.keys(FONT_FILES) as FontKey[];
  const entries = await Promise.all(
    keys.map(async (k) => [k, await read(FONT_FILES[k])] as [FontKey, Uint8Array]),
  );
  return new FontLibrary(entries);
}
