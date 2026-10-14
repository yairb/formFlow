import { beforeAll, describe, expect, it } from 'vitest';
import { buildFixtures, type Fixture } from '../fixtures/forms';
import { runFixture, totals, type FixtureScore } from './evaluate';

/**
 * Detection regression gate. Thresholds are the measured results (see
 * docs/detection.md) minus a small margin; a change that lowers them fails CI.
 * The numbers describe these generated fixtures only — not real-world accuracy.
 */

let fixtures: Fixture[];
const scores = new Map<number, FixtureScore[]>();

beforeAll(async () => {
  fixtures = await buildFixtures();
  for (const cutoff of [0.3, 0.6]) {
    const list: FixtureScore[] = [];
    for (const fx of fixtures) list.push(await runFixture(fx, cutoff));
    scores.set(cutoff, list);
  }
}, 60_000);

const byName = (cutoff: number, name: string) => scores.get(cutoff)!.find((s) => s.name === name)!;

describe('field detection on fixtures', () => {
  it('meets precision / recall at the suggestion cut-off (0.3)', () => {
    const t = totals(scores.get(0.3)!);
    expect(t.precision).toBeGreaterThanOrEqual(0.97);
    expect(t.recall).toBeGreaterThanOrEqual(0.97);
    expect(t.kindAccuracy).toBeGreaterThanOrEqual(0.95);
  });

  it('meets precision / recall at the confident cut-off (0.6)', () => {
    const t = totals(scores.get(0.6)!);
    expect(t.precision).toBeGreaterThanOrEqual(0.97);
    expect(t.recall).toBeGreaterThanOrEqual(0.95);
  });

  it('finds every field of the sample rental application with the right kind', () => {
    const s = byName(0.3, 'rental-application');
    expect(s.misses).toEqual([]);
    expect(s.falsePositives).toEqual([]);
    expect(s.kindErrors).toEqual([]);
  });

  it('handles right-to-left (Hebrew) forms', () => {
    const s = byName(0.3, 'hebrew-membership');
    expect(s.fn).toBe(0);
    expect(s.fp).toBe(0);
    expect(s.kindErrors).toEqual([]);
  });

  it('suggests nothing on documents that are not forms', () => {
    expect(byName(0.3, 'invoice-negative').falsePositives).toEqual([]);
    expect(byName(0.3, 'letter-negative').falsePositives).toEqual([]);
  });

  it('does not duplicate native AcroForm widgets', () => {
    expect(byName(0.3, 'acroform-mixed').fp).toBe(0);
  });

  it('reports scanned pages instead of guessing', () => {
    const s = byName(0.3, 'scanned-image');
    expect(s.scannedPages).toEqual([0]);
    expect(s.detected).toBe(0);
  });
});
