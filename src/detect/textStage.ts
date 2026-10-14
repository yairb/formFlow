import type { Rect } from '@/pdf/geometry';
import { cleanLabel, labelStrength } from './lexicon';
import { rectBottom, rectRight, type PageContent, type TextRun } from './primitives';

/**
 * Stage 2 — text layout. Groups text runs into phrases (pdf.js often splits a line
 * into several runs), finds blanks typed as underscores ("Name: ________") and
 * labels followed by empty space ("Comments:" with nothing after it).
 */

export interface Phrase {
  text: string;
  rect: Rect;
  fontSize: number;
  rtl: boolean;
  /** Underscore blanks were cut out of this phrase; its text is what remains. */
  hadBlanks?: boolean;
}

/** A fill-in area found from text alone. */
export interface TextBlank {
  rect: Rect;
  label: string | null;
  rtl: boolean;
  /** 'underscore': typed blank line. 'space': empty area after a colon label. */
  via: 'underscore' | 'space';
}

/** Merges runs on the same baseline that are separated by at most a word gap. */
export function groupPhrases(texts: TextRun[]): Phrase[] {
  const runs = [...texts].sort((a, b) => a.rect.y + a.rect.height - (b.rect.y + b.rect.height) || a.rect.x - b.rect.x);
  const lines: TextRun[][] = [];
  for (const r of runs) {
    const base = rectBottom(r.rect);
    const line = lines.find((l) => {
      const ref = l[0]!;
      return Math.abs(rectBottom(ref.rect) - base) < Math.max(ref.fontSize, r.fontSize) * 0.3;
    });
    if (line) line.push(r);
    else lines.push([r]);
  }
  const phrases: Phrase[] = [];
  for (const line of lines) {
    line.sort((a, b) => a.rect.x - b.rect.x);
    let cur: Phrase | null = null;
    for (const r of line) {
      const gap = cur ? r.rect.x - rectRight(cur.rect) : Infinity;
      const joinable = cur && gap < Math.max(cur.fontSize, r.fontSize) * 0.55 && gap > -cur.fontSize && !hasUnderscoreRun(cur.text) && !hasUnderscoreRun(r.str);
      if (cur && joinable) {
        const sep = gap > cur.fontSize * 0.12 && !cur.text.endsWith(' ') && !r.str.startsWith(' ') ? ' ' : '';
        // Runs are in visual (left-to-right) order; RTL phrases read right to left.
        cur.text = cur.rtl && r.rtl ? r.str + sep + cur.text : cur.text + sep + r.str;
        const x = Math.min(cur.rect.x, r.rect.x);
        const y = Math.min(cur.rect.y, r.rect.y);
        cur.rect = { x, y, width: Math.max(rectRight(cur.rect), rectRight(r.rect)) - x, height: Math.max(rectBottom(cur.rect), rectBottom(r.rect)) - y };
        cur.fontSize = Math.max(cur.fontSize, r.fontSize);
        cur.rtl = cur.rtl || r.rtl;
      } else {
        cur = { text: r.str, rect: { ...r.rect }, fontSize: r.fontSize, rtl: r.rtl };
        phrases.push(cur);
      }
    }
  }
  for (const p of phrases) p.text = p.text.trim();
  return phrases.filter((p) => p.text.length > 0);
}

/** Typed blanks: underscores, or dot leaders ("Name .........."). */
const UNDERSCORES = /_{3,}|\.{6,}|…{3,}/g;

function hasUnderscoreRun(s: string): boolean {
  return /_{3,}|\.{6,}|…{3,}/.test(s);
}

/** Approximate advance widths (em) used to locate characters inside a run. */
function charWeight(ch: string): number {
  if (ch === '_') return 0.556;
  if (ch === ' ') return 0.278;
  if (ch === '.' || ch === ',' || ch === ':' || ch === ';' || ch === 'i' || ch === 'l' || ch === '|') return 0.26;
  if (/[A-Z0-9]/.test(ch)) return 0.64;
  if (/[mwMW]/.test(ch)) return 0.82;
  return 0.52;
}

/**
 * Splits phrases containing underscore runs into labelled blanks. The label is the
 * text immediately before the run (or after it, for right-to-left text).
 */
export function findUnderscoreBlanks(phrases: Phrase[]): { blanks: TextBlank[]; rest: Phrase[] } {
  const blanks: TextBlank[] = [];
  const rest: Phrase[] = [];
  for (const p of phrases) {
    if (!hasUnderscoreRun(p.text)) {
      rest.push(p);
      continue;
    }
    const chars = [...p.text];
    const weights = chars.map(charWeight);
    const total = weights.reduce((a, b) => a + b, 0);
    const xAt = (idx: number) => p.rect.x + (p.rect.width * weights.slice(0, idx).reduce((a, b) => a + b, 0)) / total;
    // In RTL phrases the string is logical; its visual order is reversed.
    const visualX = (start: number, end: number) => {
      if (!p.rtl) return { x0: xAt(start), x1: xAt(end) };
      return { x0: rectRight(p.rect) - (xAt(end) - p.rect.x), x1: rectRight(p.rect) - (xAt(start) - p.rect.x) };
    };
    const runs = [...p.text.matchAll(UNDERSCORES)];
    let prevEnd = 0;
    runs.forEach((m, i) => {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      // Wide gaps separate independent labels on one line: keep the nearest part.
      const before = cleanLabel(p.text.slice(prevEnd, start).split(/\s{2,}/).pop() ?? '');
      const after = cleanLabel(p.text.slice(end, runs[i + 1]?.index ?? p.text.length).split(/\s{2,}/)[0] ?? '');
      // A label normally precedes the blank; a trailing label ("____ Date") is used
      // only for a leading blank.
      const label = before || (prevEnd === 0 ? after : '');
      const { x0, x1 } = visualX(start, end);
      const h = Math.max(p.fontSize * 1.25, 10);
      blanks.push({
        rect: { x: x0, y: rectBottom(p.rect) - h + p.fontSize * 0.08, width: x1 - x0, height: h },
        label: label || null,
        rtl: p.rtl,
        via: 'underscore',
      });
      prevEnd = end;
    });
    // Keep text that is not part of a label as context (e.g. headings inside the phrase).
    rest.push({ ...p, text: p.text.replace(UNDERSCORES, ' ').replace(/\s+/g, ' ').trim(), hadBlanks: true });
  }
  return { blanks, rest };
}

/**
 * "Instructions:" or "Bill to:" followed by text starting on the next line at the
 * same indent introduces a block of printed text, not an empty field.
 */
function introducesBlock(p: Phrase, phrases: Phrase[]): boolean {
  const bottom = rectBottom(p.rect);
  return phrases.some((q) => {
    if (q === p) return false;
    const dy = rectBottom(q.rect) - bottom;
    if (dy < p.fontSize * 0.8 || dy > p.fontSize * 2) return false;
    return p.rtl ? Math.abs(rectRight(q.rect) - rectRight(p.rect)) < 3 : Math.abs(q.rect.x - p.rect.x) < 3;
  });
}

/**
 * Colon labels followed by empty space up to the next text or the margin. These are
 * weak signals (lots of printed text ends with a colon), so they get low confidence
 * unless confirmed by a line or box in the merge stage.
 */
export function findSpaceBlanks(phrases: Phrase[], content: Pick<PageContent, 'width'>): TextBlank[] {
  const out: TextBlank[] = [];
  const margin = Math.max(24, content.width * 0.06);
  for (const p of phrases) {
    if (p.hadBlanks || !/[:：]\s*$/.test(p.text) || labelStrength(p.text) < 0.6) continue;
    if (introducesBlock(p, phrases)) continue;
    const midY = p.rect.y + p.rect.height / 2;
    const sameLine = phrases.filter((q) => q !== p && Math.abs(q.rect.y + q.rect.height / 2 - midY) < p.fontSize * 0.6);
    let x0: number, x1: number;
    if (p.rtl) {
      x1 = p.rect.x - p.fontSize * 0.4;
      const left = sameLine.filter((q) => rectRight(q.rect) <= p.rect.x).map((q) => rectRight(q.rect));
      x0 = (left.length ? Math.max(...left) : margin) + p.fontSize * 0.4;
    } else {
      x0 = rectRight(p.rect) + p.fontSize * 0.4;
      const right = sameLine.filter((q) => q.rect.x >= rectRight(p.rect)).map((q) => q.rect.x);
      x1 = (right.length ? Math.min(...right) : content.width - margin) - p.fontSize * 0.4;
    }
    const width = x1 - x0;
    if (width < Math.max(48, p.fontSize * 5)) continue;
    const h = Math.max(p.fontSize * 1.3, 11);
    out.push({
      rect: { x: x0, y: rectBottom(p.rect) - h + p.fontSize * 0.1, width: Math.min(width, 320), height: h },
      label: cleanLabel(p.text) || null,
      rtl: p.rtl,
      via: 'space',
    });
    if (p.rtl) {
      const last = out[out.length - 1]!;
      last.rect.x = x1 - last.rect.width;
    }
  }
  return out;
}
