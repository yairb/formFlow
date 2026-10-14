import type { DetectionSource, FieldKind, FieldShape } from '@/model/types';
import type { Rect } from '@/pdf/geometry';
import { cleanLabel, isChoiceWord, isOfficeUseText, isSignatureLabel, kindForLabel, labelStrength } from './lexicon';
import { centerOf, containsRect, overlap1d, rectBottom, rectRight, segLength, type PageContent, type PathBox, type Segment } from './primitives';
import type { Phrase } from './textStage';

/**
 * Stage 3 — vector graphics. Finds underlines, boxes, check squares, radio circles
 * and table cells, and attaches the nearest plausible label from stage 2.
 */

export interface Candidate {
  pageIndex: number;
  rect: Rect;
  kind: FieldKind;
  shape: FieldShape;
  label: string | null;
  rtl: boolean;
  confidence: number;
  sources: DetectionSource[];
  signals: string[];
}

export interface VisualResult {
  candidates: Candidate[];
  /** Areas that hold printed content or office-only sections; nothing inside is a field. */
  officeZones: Rect[];
}

const MIN_LINE = 24;
const MAX_LABEL_FONT = 14;

export function detectVisual(content: PageContent, phrases: Phrase[]): VisualResult {
  const hLines = mergeCollinear(content.hLines, 'h');
  const vLines = mergeCollinear(content.vLines, 'v');
  const out: Candidate[] = [];
  const officeZones: Rect[] = [];

  const table = detectTables(content, hLines, vLines, phrases);
  out.push(...table.candidates);

  const boxes = content.boxes.filter((b) => !table.cellRects.some((c) => nearlySameRect(c, b.rect)));
  const boxResult = detectBoxes(content, boxes, phrases);
  out.push(...boxResult.candidates);
  officeZones.push(...boxResult.officeZones);

  const freeLines = hLines.filter((l) => !l.fromBox && !table.usedH.has(l));
  out.push(...detectUnderlines(content, freeLines, hLines, phrases));

  return { candidates: out, officeZones };
}

// ---------------------------------------------------------------------------
// Segment clean-up
// ---------------------------------------------------------------------------

/** Joins segments that continue each other on the same line (rules drawn in pieces). */
export function mergeCollinear(segs: Segment[], dir: 'h' | 'v'): Segment[] {
  const key = (s: Segment) => (dir === 'h' ? s.y1 : s.x1);
  const lo = (s: Segment) => (dir === 'h' ? s.x1 : s.y1);
  const hi = (s: Segment) => (dir === 'h' ? s.x2 : s.y2);
  const sorted = [...segs].sort((a, b) => key(a) - key(b) || lo(a) - lo(b));
  const out: Segment[] = [];
  for (const s of sorted) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(key(prev) - key(s)) < 0.8 && lo(s) <= hi(prev) + 1.2 && !!prev.fromBox === !!s.fromBox) {
      if (dir === 'h') prev.x2 = Math.max(prev.x2, s.x2);
      else prev.y2 = Math.max(prev.y2, s.y2);
      prev.thickness = Math.max(prev.thickness, s.thickness);
    } else {
      out.push({ ...s });
    }
  }
  return out;
}

function nearlySameRect(a: Rect, b: Rect, tol = 1.5): boolean {
  return Math.abs(a.x - b.x) < tol && Math.abs(a.y - b.y) < tol && Math.abs(a.width - b.width) < tol && Math.abs(a.height - b.height) < tol;
}

function phrasesInside(r: Rect, phrases: Phrase[]): Phrase[] {
  return phrases.filter((p) => {
    const c = centerOf(p.rect);
    return c.x > r.x && c.x < rectRight(r) && c.y > r.y && c.y < rectBottom(r);
  });
}

function labelKind(label: string | null, fallback: FieldKind): FieldKind {
  return kindForLabel(label, fallback);
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

interface TableResult {
  candidates: Candidate[];
  cellRects: Rect[];
  usedH: Set<Segment>;
}

function detectTables(content: PageContent, hLines: Segment[], vLines: Segment[], phrases: Phrase[]): TableResult {
  const result: TableResult = { candidates: [], cellRects: [], usedH: new Set() };
  const hs = hLines.filter((h) => segLength(h) >= MIN_LINE).sort((a, b) => a.y1 - b.y1);
  const vs = vLines.filter((v) => segLength(v) >= 8);
  if (vs.length < 3) return result;

  interface Row {
    top: Segment;
    bottom: Segment;
    xs: number[];
  }
  const rows: Row[] = [];
  for (let i = 0; i < hs.length; i++) {
    const a = hs[i]!;
    // The next line below that shares an x-range forms the row's bottom edge.
    for (let j = i + 1; j < hs.length; j++) {
      const b = hs[j]!;
      if (b.y1 - a.y1 < 6) continue;
      if (b.y1 - a.y1 > 120) break;
      const x0 = Math.max(a.x1, b.x1);
      const x1 = Math.min(a.x2, b.x2);
      if (x1 - x0 < MIN_LINE) continue;
      const xs = vs
        .filter((v) => v.x1 >= x0 - 1.5 && v.x1 <= x1 + 1.5 && v.y1 <= a.y1 + 1.5 && v.y2 >= b.y1 - 1.5)
        .map((v) => v.x1)
        .sort((p, q) => p - q);
      const uniq = xs.filter((x, k) => k === 0 || x - xs[k - 1]! > 3);
      if (uniq.length >= 3) rows.push({ top: a, bottom: b, xs: uniq });
      break;
    }
  }
  if (rows.length === 0) return result;

  // Group rows into tables by shared column structure and adjacency.
  const tables: Row[][] = [];
  for (const r of rows) {
    const t = tables.find((tb) => {
      const last = tb[tb.length - 1]!;
      return Math.abs(last.bottom.y1 - r.top.y1) < 1.5 && r.xs.some((x) => last.xs.some((y) => Math.abs(x - y) < 2));
    });
    if (t) t.push(r);
    else tables.push([r]);
  }

  for (const t of tables) {
    // A table needs at least two rows, or a single row with a printed label cell.
    const cells: { rect: Rect; row: number; col: number; text: string }[] = [];
    t.forEach((r, ri) => {
      for (let k = 1; k < r.xs.length; k++) {
        const rect = { x: r.xs[k - 1]!, y: r.top.y1, width: r.xs[k]! - r.xs[k - 1]!, height: r.bottom.y1 - r.top.y1 };
        const inside = phrasesInside(rect, phrases);
        cells.push({ rect, row: ri, col: k - 1, text: inside.map((p) => p.text).join(' ').trim() });
      }
    });
    if (t.length < 2 && !cells.some((c) => c.text)) continue;
    for (const r of t) {
      result.usedH.add(r.top);
      result.usedH.add(r.bottom);
    }
    for (const c of cells) result.cellRects.push(c.rect);

    const headerRow = t.findIndex((_, ri) => cells.some((c) => c.row === ri && c.text));
    const office = cells.some((c) => isOfficeUseText(c.text));
    for (const c of cells) {
      if (c.text || c.rect.width < 14 || c.rect.height < 8) continue;
      const header = cells.find((h) => h.row === headerRow && h.col === c.col && h.text && headerRow < c.row);
      const left = cells.find((h) => h.row === c.row && h.col === c.col - 1 && h.text);
      let label: string | null = null;
      let confidence = 0.42;
      const signals = ['empty table cell'];
      if (left && labelStrength(left.text) >= 0.3) {
        label = cleanLabel(left.text);
        confidence = 0.82;
        signals.push(`label cell: ${label}`);
      } else if (header) {
        label = `${cleanLabel(header.text)} (row ${c.row - headerRow})`;
        confidence = 0.74;
        signals.push(`column: ${cleanLabel(header.text)}`);
      }
      if (office) {
        confidence = Math.min(confidence, 0.2);
        signals.push('office-use table');
      }
      result.candidates.push({
        pageIndex: content.pageIndex,
        rect: inset(c.rect, 0.8),
        kind: labelKind(header ? cleanLabel(header.text) : label, c.rect.height >= 34 ? 'multiline' : 'text'),
        shape: 'box',
        label,
        rtl: !!(left ?? header) && /[֐-ࣿ]/.test((left ?? header)!.text),
        confidence,
        sources: label ? ['visual', 'text'] : ['visual'],
        signals,
      });
    }
  }
  return result;
}

function inset(r: Rect, d: number): Rect {
  return { x: r.x + d, y: r.y + d, width: Math.max(1, r.width - d * 2), height: Math.max(1, r.height - d * 2) };
}

// ---------------------------------------------------------------------------
// Boxes, check squares and radio circles
// ---------------------------------------------------------------------------

function detectBoxes(content: PageContent, boxes: PathBox[], phrases: Phrase[]): { candidates: Candidate[]; officeZones: Rect[] } {
  const candidates: Candidate[] = [];
  const officeZones: Rect[] = [];
  const pageArea = content.width * content.height;
  const { combs, rest } = groupCombs(boxes);

  for (const b of [...combs, ...rest]) {
    const r = b.rect;
    // Tinted bands (section headings) and solid shapes are decoration.
    if (!b.stroked && !(b.filled && b.lightFill)) continue;
    if (r.width * r.height > pageArea * 0.4) continue;

    const comb = combs.includes(b);
    const square = !comb && Math.abs(r.width - r.height) <= Math.max(r.width, r.height) * 0.25;
    if (square && r.width >= 5 && r.width <= 22) {
      candidates.push(checkCandidate(content, b, phrases));
      continue;
    }
    if (r.width < 28 || r.height < 9) continue;

    const inside = phrasesInside(r, phrases);
    const nested = !comb && boxes.some((o) => o !== b && containsRect(r, o.rect, 0.5) && o.rect.width * o.rect.height < r.width * r.height * 0.9);
    if (inside.some((p) => isOfficeUseText(p.text))) {
      officeZones.push(r);
      continue;
    }
    if (nested) continue;
    // A caption printed in the box's top-left corner is its label.
    const caption = inside.length === 1 && inside[0]!.rect.y - r.y < 12 && inside[0]!.rect.x - r.x < 14 && inside[0]!.fontSize <= 9 ? inside[0]! : null;
    if (inside.length > 0 && !caption) continue; // already holds content

    let label: string | null = null;
    const signals: string[] = [comb ? 'character boxes' : b.stroked ? 'outlined box' : 'blank box'];
    let rtl = false;
    if (caption) {
      label = cleanLabel(caption.text);
      rtl = caption.rtl;
      signals.push(`caption: ${label}`);
    } else {
      const above = phrases
        .filter((p) => p.fontSize <= MAX_LABEL_FONT && rectBottom(p.rect) <= r.y + 2 && rectBottom(p.rect) >= r.y - 14 && overlap1d(p.rect.x, rectRight(p.rect), r.x, rectRight(r)) > 0)
        .filter((p) => (p.rtl ? Math.abs(rectRight(p.rect) - rectRight(r)) < 16 : Math.abs(p.rect.x - r.x) < 16))
        .sort((p, q) => rectBottom(q.rect) - rectBottom(p.rect))[0];
      const left = phrases
        .filter((p) => p.fontSize <= MAX_LABEL_FONT && rectRight(p.rect) <= r.x + 1 && rectRight(p.rect) >= r.x - 60)
        .filter((p) => centerOf(p.rect).y > r.y && centerOf(p.rect).y < rectBottom(r))
        .sort((p, q) => rectRight(q.rect) - rectRight(p.rect))[0];
      const right = phrases
        .filter((p) => p.rtl && p.fontSize <= MAX_LABEL_FONT && p.rect.x >= rectRight(r) - 1 && p.rect.x <= rectRight(r) + 60)
        .filter((p) => centerOf(p.rect).y > r.y && centerOf(p.rect).y < rectBottom(r))
        .sort((p, q) => p.rect.x - q.rect.x)[0];
      const pick = above ?? right ?? left;
      if (pick && labelStrength(pick.text) > 0) {
        label = cleanLabel(pick.text);
        rtl = pick.rtl;
        signals.push(`label ${pick === above ? 'above' : 'beside'}: ${label}`);
      }
    }
    const tall = r.height >= 30;
    const kind = labelKind(label, tall ? 'multiline' : 'text');
    const field: Rect = caption ? { x: r.x, y: Math.min(rectBottom(r) - 8, rectBottom(caption.rect) + 1), width: r.width, height: 0 } : r;
    if (caption) field.height = rectBottom(r) - field.y;
    candidates.push({
      pageIndex: content.pageIndex,
      rect: inset(field, 0.6),
      kind: kind === 'signature' && !tall && r.height < 18 ? 'text' : kind,
      shape: 'box',
      label,
      rtl,
      confidence: label ? (labelStrength(label) >= 0.6 ? 0.88 : 0.82) : 0.45,
      sources: label ? ['visual', 'text'] : ['visual'],
      signals,
    });
  }
  return { candidates, officeZones };
}

/**
 * Rows of three or more equal squares touching each other are "comb" boxes (one
 * character per cell, e.g. postcodes and ID numbers): one field, not checkboxes.
 */
function groupCombs(boxes: PathBox[]): { combs: PathBox[]; rest: PathBox[] } {
  const squares = boxes
    .filter((b) => b.stroked && !b.round && b.rect.width >= 6 && b.rect.width <= 24 && Math.abs(b.rect.width - b.rect.height) <= b.rect.height * 0.3)
    .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
  const used = new Set<PathBox>();
  const combs: PathBox[] = [];
  for (const start of squares) {
    if (used.has(start)) continue;
    const run = [start];
    for (;;) {
      const last = run[run.length - 1]!.rect;
      const next = squares.find(
        (o) => !used.has(o) && !run.includes(o) && Math.abs(o.rect.y - last.y) < 0.8 && Math.abs(o.rect.height - last.height) < 0.8 && o.rect.x - rectRight(last) > -1.5 && o.rect.x - rectRight(last) < 2.5,
      );
      if (!next) break;
      run.push(next);
    }
    if (run.length < 3) continue;
    for (const b of run) used.add(b);
    const first = run[0]!.rect;
    const last = run[run.length - 1]!.rect;
    combs.push({ rect: { x: first.x, y: first.y, width: rectRight(last) - first.x, height: first.height }, stroked: true, filled: false, lightFill: false, round: false });
  }
  return { combs, rest: boxes.filter((b) => !used.has(b)) };
}

function checkCandidate(content: PageContent, b: PathBox, phrases: Phrase[]): Candidate {
  const r = b.rect;
  const cy = r.y + r.height / 2;
  const onLine = phrases.filter((p) => Math.abs(centerOf(p.rect).y - cy) < Math.max(r.height, p.fontSize) * 0.75 && p.fontSize <= MAX_LABEL_FONT);
  const right = onLine.filter((p) => p.rect.x >= rectRight(r) - 1 && p.rect.x - rectRight(r) < 14).sort((p, q) => p.rect.x - q.rect.x)[0];
  const left = onLine.filter((p) => rectRight(p.rect) <= r.x + 1 && r.x - rectRight(p.rect) < 14).sort((p, q) => rectRight(q.rect) - rectRight(p.rect))[0];
  // Reading direction decides which side the option text is on.
  const pick = right && !right.rtl ? right : left && left.rtl ? left : (right ?? left);
  let label = pick ? cleanLabel(pick.text) : null;
  const signals = [b.round ? 'small circle' : 'small square'];
  if (pick && label) {
    signals.push(`option text: ${label}`);
    if (isChoiceWord(label)) {
      // "Yes" / "No" options: prefix the question printed earlier on the line.
      const rtl = pick.rtl;
      const question = onLine
        .filter((p) => p !== pick && !isChoiceWord(p.text) && (rtl ? p.rect.x > rectRight(r) : rectRight(p.rect) < r.x))
        .sort((p, q) => (rtl ? p.rect.x - q.rect.x : rectRight(q.rect) - rectRight(p.rect)))[0];
      if (question) label = `${cleanLabel(question.text)} — ${label}`;
    }
  }
  return {
    pageIndex: content.pageIndex,
    rect: { ...r },
    kind: b.round ? 'radio' : 'checkbox',
    shape: b.round ? 'circle' : 'square',
    label,
    rtl: !!pick?.rtl,
    confidence: label ? 0.9 : 0.55,
    sources: label ? ['visual', 'text'] : ['visual'],
    signals,
  };
}

// ---------------------------------------------------------------------------
// Underlines ("Name ____________")
// ---------------------------------------------------------------------------

function detectUnderlines(content: PageContent, lines: Segment[], allH: Segment[], phrases: Phrase[]): Candidate[] {
  const out: Candidate[] = [];
  for (const line of lines) {
    if (line.thickness > 2.5) continue;
    const y = line.y1;
    // Text sitting on the line: either the label (at one end) or underlined text.
    const onLine = phrases.filter((p) => {
      const base = rectBottom(p.rect);
      return base <= y + 1.5 && base >= y - p.fontSize * 0.9 && overlap1d(p.rect.x, rectRight(p.rect), line.x1, line.x2) > 1;
    });
    let x1 = line.x1;
    let x2 = line.x2;
    let label: Phrase | null = null;
    let labelPos: 'left' | 'right' | 'below' | 'on' | 'far' | null = null;
    if (onLine.length > 0) {
      // A page-wide rule under text is a heading underline or separator.
      if (segLength(line) > content.width * 0.6) continue;
      // Keep the longest stretch of the line not covered by text.
      const covered = onLine.map((p) => [p.rect.x - 2, rectRight(p.rect) + 2] as const).sort((a, b) => a[0] - b[0]);
      let best: [number, number] = [0, 0];
      let cursor = line.x1;
      for (const [a, b] of [...covered, [line.x2, line.x2] as const]) {
        if (a - cursor > best[1] - best[0]) best = [cursor, a];
        cursor = Math.max(cursor, b);
      }
      if (best[1] - best[0] < MIN_LINE) continue;
      [x1, x2] = best;
      const before = onLine.find((p) => Math.abs(rectRight(p.rect) + 2 - x1) < 1);
      const after = onLine.find((p) => Math.abs(p.rect.x - 2 - x2) < 1);
      const on = (after?.rtl ? after : before) ?? after ?? null;
      if (on && on.fontSize <= MAX_LABEL_FONT && labelStrength(on.text) > 0) {
        label = on;
        labelPos = 'on';
      }
    }
    const len = x2 - x1;
    if (len < MIN_LINE) continue;

    if (!label) {
      const near = (p: Phrase) => p.fontSize <= MAX_LABEL_FONT && Math.abs(rectBottom(p.rect) - y) < Math.max(6, p.fontSize * 0.9);
      const left = phrases.filter((p) => near(p) && rectRight(p.rect) <= x1 + 3 && rectRight(p.rect) >= x1 - 60).sort((p, q) => rectRight(q.rect) - rectRight(p.rect))[0];
      const right = phrases.filter((p) => near(p) && p.rect.x >= x2 - 3 && p.rect.x <= x2 + 60).sort((p, q) => p.rect.x - q.rect.x)[0];
      if (right?.rtl && labelStrength(right.text) > 0) [label, labelPos] = [right, 'right'];
      else if (left && labelStrength(left.text) > 0) [label, labelPos] = [left, 'left'];
    }
    if (!label) {
      // Tabular layouts: labels in their own column, the line starting further right.
      // Only the nearest text on the same baseline, with nothing in between.
      const base = (p: Phrase) => p.fontSize <= MAX_LABEL_FONT && Math.abs(rectBottom(p.rect) - y) < Math.max(6, p.fontSize * 0.9);
      const far = phrases.filter((p) => base(p) && rectRight(p.rect) <= x1 && x1 - rectRight(p.rect) <= 200).sort((p, q) => rectRight(q.rect) - rectRight(p.rect))[0];
      if (far && !far.rtl && labelStrength(far.text) > 0) [label, labelPos] = [far, 'far'];
    }
    if (!label) {
      const below = phrases
        .filter((p) => p.fontSize <= 10 && p.rect.y >= y + 0.5 && p.rect.y <= y + 12)
        .filter((p) => (p.rtl ? Math.abs(rectRight(p.rect) - x2) < 14 : Math.abs(p.rect.x - x1) < 14) && p.rect.width < len)
        .sort((p, q) => p.rect.y - q.rect.y)[0];
      if (below && labelStrength(below.text) > 0) [label, labelPos] = [below, 'below'];
    }

    const labelText = label ? cleanLabel(label.text) : null;
    let confidence: number;
    const signals = ['blank line'];
    if (labelText) {
      confidence = labelPos === 'far' ? 0.7 : labelPos === 'below' ? 0.8 : labelStrength(label!.text) >= 0.6 ? 0.9 : 0.85;
      signals.push(`label ${labelPos}: ${labelText}`);
    } else {
      confidence = len > content.width * 0.6 || line.thickness >= 1 ? 0.15 : 0.38;
      signals.push('no label nearby');
    }

    // Height: room above the line, up to the text or rule above it.
    const obstacles = [
      ...phrases.filter((p) => rectBottom(p.rect) < y - 1 && overlap1d(p.rect.x, rectRight(p.rect), x1, x2) > 2).map((p) => rectBottom(p.rect)),
      ...allH.filter((h) => h !== line && h.y1 < y - 1 && overlap1d(h.x1, h.x2, x1, x2) > 2).map((h) => h.y1),
    ];
    const room = obstacles.length ? y - Math.max(...obstacles) - 1.5 : 20;
    let kind = labelKind(labelText, 'text');
    if (labelPos === 'below' && labelText && isSignatureLabel(labelText)) kind = 'signature';
    const height = kind === 'signature' ? clamp(room, 14, 40) : clamp(room, 10, 20);
    out.push({
      pageIndex: content.pageIndex,
      rect: { x: x1, y: y - height, width: len, height },
      kind,
      shape: 'line',
      label: labelText,
      rtl: !!label?.rtl,
      confidence,
      sources: labelText ? ['visual', 'text'] : ['visual'],
      signals,
    });
  }
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
