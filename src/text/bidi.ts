import bidiFactory from 'bidi-js';

const bidi = bidiFactory();

export type TextDirection = 'ltr' | 'rtl';

const STRONG_RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFC]/;
const STRONG_LTR = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/;

/** Direction of a paragraph from its first strong character (Unicode rule P2/P3). */
export function paragraphDirection(text: string): TextDirection {
  for (const ch of text) {
    if (STRONG_RTL.test(ch)) return 'rtl';
    if (STRONG_LTR.test(ch)) return 'ltr';
  }
  return 'ltr';
}

export function containsRtl(text: string): boolean {
  return STRONG_RTL.test(text);
}

/**
 * Reorders a single line from logical to visual (left-to-right) order using the
 * Unicode Bidirectional Algorithm, including mirroring of brackets.
 */
export function toVisualOrder(line: string, direction: TextDirection): string {
  if (!line || (!containsRtl(line) && direction === 'ltr')) return line;
  const levels = bidi.getEmbeddingLevels(line, direction);
  const chars = line.split('');
  // bidi-js reads `embeddingLevels[i]`, i.e. the raw levels array, although its
  // typings declare the result object (passing that silently mirrors nothing).
  const mirrored = bidi.getMirroredCharactersMap(line, levels.levels as unknown as typeof levels);
  mirrored.forEach((replacement, index) => {
    chars[index] = replacement;
  });
  for (const [start, end] of bidi.getReorderSegments(line, levels)) {
    const slice = chars.slice(start, end + 1).reverse();
    chars.splice(start, slice.length, ...slice);
  }
  // Reversal swaps surrogate pairs; restore them.
  for (let i = 0; i < chars.length - 1; i++) {
    const c = chars[i]!.charCodeAt(0);
    if (c >= 0xdc00 && c <= 0xdfff) {
      const n = chars[i + 1]!.charCodeAt(0);
      if (n >= 0xd800 && n <= 0xdbff) {
        [chars[i], chars[i + 1]] = [chars[i + 1]!, chars[i]!];
        i++;
      }
    }
  }
  return chars.join('');
}

const HEBREW_FINALS = /[ךםןףץ]/;

/**
 * PDF text extraction returns RTL runs in logical or visual order depending on how
 * the file was produced. Hebrew final letters (ך ם ן ף ץ) only occur at the end of
 * a word in logical order, so finals found at word starts reveal reversed text.
 * Returns > 0 when `run` looks reversed, < 0 when it looks logical, 0 without evidence.
 */
export function reversedOrderEvidence(run: string): number {
  let score = 0;
  for (const word of run.split(/[^\u0590-\u05FF]+/)) {
    if (word.length < 2) continue;
    if (HEBREW_FINALS.test(word[0]!)) score++;
    if (HEBREW_FINALS.test(word[word.length - 1]!)) score--;
  }
  return score;
}

/**
 * Puts extracted RTL runs into logical order. The decision is made for the whole
 * set (one page): a producer either reverses all its runs or none, and most short
 * labels carry no evidence of their own.
 */
export function toLogicalOrder(runs: string[]): string[] {
  const evidence = runs.reduce((n, r) => (containsRtl(r) ? n + reversedOrderEvidence(r) : n), 0);
  if (evidence <= 0) return runs;
  return runs.map((r) => (containsRtl(r) ? toVisualOrder(r, 'rtl') : r));
}
