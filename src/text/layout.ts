import { paragraphDirection, type TextDirection } from './bidi';
import type { DocFontFamily, FontLibrary } from './fonts';
import { lineHeightPt } from './metrics';

export interface TextStyle {
  family: DocFontFamily;
  bold: boolean;
  size: number;
}

export interface LaidOutLine {
  /** Logical-order text of the line (no trailing newline). */
  text: string;
  /** Advance width excluding trailing whitespace (which never affects placement). */
  width: number;
  direction: TextDirection;
}

export interface TextLayout {
  lines: LaidOutLine[];
  /** Widest line, in points. */
  contentWidth: number;
  height: number;
  lineHeight: number;
}

export type Measure = (text: string) => number;

export function measureWith(lib: FontLibrary, style: TextStyle): Measure {
  return (t) => lib.measure(t, style.family, style.bold, style.size);
}

/**
 * Lays text out into lines. With `maxWidth === null` only explicit newlines break
 * lines (auto-width text boxes); otherwise words wrap greedily like CSS
 * `white-space: pre-wrap; overflow-wrap: anywhere`.
 */
export function layoutText(
  text: string,
  style: TextStyle,
  maxWidth: number | null,
  measure: Measure,
): TextLayout {
  const lineHeight = lineHeightPt(style.size);
  const lines: LaidOutLine[] = [];
  const paragraphs = text.replace(/\r\n?/g, '\n').split('\n');
  for (const para of paragraphs) {
    const direction = paragraphDirection(para);
    if (maxWidth === null || para === '') {
      lines.push({ text: para, width: measure(para.replace(/\s+$/, '')), direction });
      continue;
    }
    for (const t of wrapParagraph(para, maxWidth, measure)) {
      lines.push({ text: t, width: measure(t.replace(/\s+$/, '')), direction });
    }
  }
  const contentWidth = lines.reduce((m, l) => Math.max(m, l.width), 0);
  return { lines, contentWidth, height: lines.length * lineHeight, lineHeight };
}

function wrapParagraph(para: string, maxWidth: number, measure: Measure): string[] {
  // Tokens alternate between words and whitespace runs so spaces are preserved.
  const tokens = para.match(/\s+|[^\s]+/g) ?? [''];
  const out: string[] = [];
  let line = '';
  for (const token of tokens) {
    const candidate = line + token;
    if (/^\s+$/.test(token) || measure(candidate.replace(/\s+$/, '')) <= maxWidth + 0.01) {
      line = candidate;
      continue;
    }
    if (line.trim() !== '') {
      out.push(line);
      line = '';
    } else if (line) {
      // Leading whitespace only: keep it attached to the next word.
    }
    if (measure(token) <= maxWidth + 0.01) {
      line += token;
      continue;
    }
    // A single word wider than the box: break it by characters.
    for (const ch of token) {
      if (line && measure(line + ch) > maxWidth + 0.01) {
        out.push(line);
        line = '';
      }
      line += ch;
    }
  }
  out.push(line);
  return out;
}
