import { newId } from '@/model/ids';
import type { FormField } from '@/model/types';
import { rectCenter, rectContains, rectCoverage, rectIoU, rectUnion, type Rect } from '@/pdf/geometry';
import { kindForLabel } from './lexicon';
import type { Phrase, TextBlank } from './textStage';
import type { Candidate } from './visualStage';

/**
 * Stage 4 — merge and classify. Combines text-only blanks with vector candidates,
 * drops anything already covered by a native form field, lowers confidence inside
 * office-use zones, and orders the result for guided filling.
 */

/** Candidates below this are discarded rather than shown as suggestions. */
export const MIN_CONFIDENCE = 0.3;

export interface MergeInput {
  pageIndex: number;
  native: FormField[];
  blanks: TextBlank[];
  visual: Candidate[];
  officeZones: Rect[];
  phrases: Phrase[];
}

export function blankToCandidate(pageIndex: number, b: TextBlank): Candidate {
  const confidence = b.via === 'underscore' ? (b.label ? 0.8 : 0.6) : 0.4;
  return {
    pageIndex,
    rect: { ...b.rect },
    kind: kindForLabel(b.label, 'text'),
    shape: 'line',
    label: b.label,
    rtl: b.rtl,
    confidence,
    sources: b.label ? ['text'] : ['text'],
    signals: [b.via === 'underscore' ? 'typed blank (underscores)' : 'empty space after label', ...(b.label ? [`label: ${b.label}`] : [])],
  };
}

function sameArea(a: Rect, b: Rect): boolean {
  if (rectIoU(a, b) > 0.3) return true;
  // A short text blank inside a longer drawn line (or vice versa).
  const small = a.width * a.height <= b.width * b.height ? a : b;
  const large = small === a ? b : a;
  return rectCoverage(small, large) > 0.55;
}

export function mergePage(input: MergeInput): Candidate[] {
  const text = input.blanks.map((b) => blankToCandidate(input.pageIndex, b));
  let all: Candidate[] = [];

  // Vector candidates first: their geometry is exact.
  for (const c of input.visual) addOrMerge(all, c);
  for (const c of text) addOrMerge(all, c);

  // Native widgets win over anything detected in the same place.
  all = all.filter((c) => !input.native.some((n) => rectCoverage(c.rect, n.rect) > 0.3 || rectCoverage(n.rect, c.rect) > 0.5));

  for (const c of all) {
    const center = rectCenter(c.rect);
    if (input.officeZones.some((z) => rectContains(z, center))) {
      c.confidence = Math.min(c.confidence, 0.25);
      c.signals.push('inside office-use area');
    }
  }
  return all.filter((c) => c.confidence >= MIN_CONFIDENCE);
}

function addOrMerge(list: Candidate[], c: Candidate): void {
  const twin = list.find((o) => o.kind !== 'checkbox' && o.kind !== 'radio' && c.kind !== 'checkbox' && c.kind !== 'radio' && sameArea(o.rect, c.rect));
  if (!twin) {
    list.push({ ...c, signals: [...c.signals], sources: [...c.sources] });
    return;
  }
  // Agreement between independent stages raises confidence.
  const agrees = c.sources.some((s) => !twin.sources.includes(s)) || twin.sources.length === 1;
  twin.sources = [...new Set([...twin.sources, ...c.sources])];
  if (!twin.label && c.label) {
    twin.label = c.label;
    twin.rtl = c.rtl;
    twin.kind = kindForLabel(c.label, twin.kind);
  }
  twin.confidence = Math.min(0.97, Math.max(twin.confidence, c.confidence) + (agrees ? 0.05 : 0));
  // Keep the drawn geometry, but grow a line field when the text blank is taller.
  if (twin.shape === 'line' && c.shape === 'line' && c.rect.height > twin.rect.height) {
    const bottom = twin.rect.y + twin.rect.height;
    twin.rect = { ...twin.rect, y: bottom - c.rect.height, height: c.rect.height };
  } else if (twin.shape === 'line' && c.shape === 'line' && rectCoverage(c.rect, twin.rect) < 0.9) {
    twin.rect = rectUnion(twin.rect, c.rect);
  }
  for (const s of c.signals) if (!twin.signals.includes(s)) twin.signals.push(s);
}

/** Majority direction of the page's text decides left-to-right vs right-to-left order. */
export function pageIsRtl(phrases: Phrase[]): boolean {
  let rtl = 0;
  let ltr = 0;
  for (const p of phrases) {
    if (p.rtl) rtl += p.text.length;
    else ltr += p.text.length;
  }
  return rtl > ltr;
}

/** Reading order: rows top to bottom, then along the row in reading direction. */
export function readingOrder<T extends { rect: Rect }>(items: T[], rtl: boolean): T[] {
  const sorted = [...items].sort((a, b) => a.rect.y + a.rect.height - (b.rect.y + b.rect.height));
  const rows: T[][] = [];
  for (const it of sorted) {
    const bottom = it.rect.y + it.rect.height;
    const row = rows[rows.length - 1];
    const refBottom = row ? row[0]!.rect.y + row[0]!.rect.height : -Infinity;
    if (row && Math.abs(bottom - refBottom) < 7) row.push(it);
    else rows.push([it]);
  }
  return rows.flatMap((r) => r.sort((a, b) => (rtl ? b.rect.x - a.rect.x : a.rect.x - b.rect.x)));
}

export function candidateToField(c: Candidate): FormField {
  return {
    id: newId('fld'),
    pageIndex: c.pageIndex,
    rect: c.rect,
    kind: c.kind,
    shape: c.shape,
    label: c.label,
    confidence: Math.round(c.confidence * 100) / 100,
    sources: c.sources,
    review: 'suggested',
    skipped: false,
    notApplicable: false,
    rtl: c.rtl,
    signals: c.signals,
  };
}
