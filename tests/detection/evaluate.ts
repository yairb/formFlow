import { detectFields } from '@/detect';
import { readNativeFields } from '@/detect/acroform';
import type { FormField } from '@/model/types';
import { openPdf } from '@/pdf/loader';
import type { TruthField } from '@/samples/truth';
import type { Fixture } from '../fixtures/forms';

/**
 * Scores detection against fixture ground truth. A detection matches a truth field
 * on the same page when it covers the same writing area:
 *   - check squares / radios: centres within 6 pt;
 *   - text areas: horizontal overlap ≥ 60 % of the wider of the two, and the
 *     bottoms (the writing baseline) within 10 pt or the rects' IoU ≥ 0.4.
 * Matching is one-to-one (greedy, best overlap first). Native AcroForm widgets are
 * excluded from the score — they are read, not detected — but a detection that
 * duplicates one counts as a false positive.
 */

export interface FixtureScore {
  name: string;
  truth: number;
  detected: number;
  tp: number;
  fp: number;
  fn: number;
  kindCorrect: number;
  misses: string[];
  falsePositives: string[];
  kindErrors: string[];
  scannedPages: number[];
}

export interface Totals {
  truth: number;
  detected: number;
  tp: number;
  fp: number;
  fn: number;
  kindCorrect: number;
  precision: number;
  recall: number;
  kindAccuracy: number;
}

function overlap(a0: number, a1: number, b0: number, b1: number) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

const isMark = (k: string) => k === 'checkbox' || k === 'radio';

export function matchScore(d: FormField, t: TruthField): number {
  if (d.pageIndex !== t.pageIndex) return 0;
  const a = d.rect;
  const b = t.rect;
  if (isMark(t.kind) || isMark(d.kind)) {
    const dx = a.x + a.width / 2 - (b.x + b.width / 2);
    const dy = a.y + a.height / 2 - (b.y + b.height / 2);
    const dist = Math.hypot(dx, dy);
    return isMark(t.kind) && isMark(d.kind) && dist <= 6 ? 1 - dist / 12 : 0;
  }
  const ox = overlap(a.x, a.x + a.width, b.x, b.x + b.width) / Math.max(a.width, b.width);
  if (ox < 0.6) return 0;
  const bottoms = Math.abs(a.y + a.height - (b.y + b.height));
  const inter = ox * Math.max(a.width, b.width) * overlap(a.y, a.y + a.height, b.y, b.y + b.height);
  const iou = inter / (a.width * a.height + b.width * b.height - inter);
  if (bottoms > 10 && iou < 0.4) return 0;
  return ox * 0.6 + Math.max(iou, 1 - bottoms / 20) * 0.4;
}

export async function runFixture(fx: Fixture, minConfidence: number): Promise<FixtureScore> {
  const opened = await openPdf(fx.bytes);
  const native: FormField[] = [];
  for (const geom of opened.pages) native.push(...(await readNativeFields(await opened.doc.getPage(geom.index + 1), geom)));
  const result = await detectFields(opened, native);
  await opened.doc.destroy();

  const nativeSet = new Set(fx.nativeLabels ?? []);
  const truth = fx.truth.filter((t) => !nativeSet.has(t.label));
  const detected = result.fields.filter((f) => !f.native && f.confidence >= minConfidence);

  const pairs: { d: number; t: number; s: number }[] = [];
  detected.forEach((d, di) => truth.forEach((t, ti) => {
    const s = matchScore(d, t);
    if (s > 0) pairs.push({ d: di, t: ti, s });
  }));
  pairs.sort((a, b) => b.s - a.s);
  const usedD = new Set<number>();
  const usedT = new Set<number>();
  let kindCorrect = 0;
  const kindErrors: string[] = [];
  for (const p of pairs) {
    if (usedD.has(p.d) || usedT.has(p.t)) continue;
    usedD.add(p.d);
    usedT.add(p.t);
    const d = detected[p.d]!;
    const t = truth[p.t]!;
    if (d.kind === t.kind) kindCorrect++;
    else kindErrors.push(`“${t.label}”: expected ${t.kind}, got ${d.kind}`);
  }
  const describe = (f: { pageIndex: number; label: string | null; kind: string; rect: { x: number; y: number } }) =>
    `p${f.pageIndex + 1} ${f.kind} “${f.label ?? '—'}” @${f.rect.x.toFixed(0)},${f.rect.y.toFixed(0)}`;
  return {
    name: fx.name,
    truth: truth.length,
    detected: detected.length,
    tp: usedT.size,
    fp: detected.length - usedD.size,
    fn: truth.length - usedT.size,
    kindCorrect,
    misses: truth.filter((_, i) => !usedT.has(i)).map(describe),
    falsePositives: detected.filter((_, i) => !usedD.has(i)).map((d) => `${describe(d)} (${d.confidence.toFixed(2)})`),
    kindErrors,
    scannedPages: result.scannedPages,
  };
}

export function totals(scores: FixtureScore[]): Totals {
  const sum = (k: 'truth' | 'detected' | 'tp' | 'fp' | 'fn' | 'kindCorrect') => scores.reduce((n, s) => n + s[k], 0);
  const tp = sum('tp');
  const detected = sum('detected');
  const truth = sum('truth');
  return {
    truth,
    detected,
    tp,
    fp: sum('fp'),
    fn: sum('fn'),
    kindCorrect: sum('kindCorrect'),
    precision: detected ? tp / detected : 1,
    recall: truth ? tp / truth : 1,
    kindAccuracy: tp ? sum('kindCorrect') / tp : 1,
  };
}
