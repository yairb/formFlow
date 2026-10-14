import { describe, expect, it } from 'vitest';
import { readingOrder } from './merge';
import type { PageContent, PathBox } from './primitives';
import { detectVisual, mergeCollinear } from './visualStage';

const page = (over: Partial<PageContent>): PageContent => ({ pageIndex: 0, width: 612, height: 792, texts: [], hLines: [], vLines: [], boxes: [], imageCoverage: 0, ...over });
const box = (x: number, y: number, w: number, h: number): PathBox => ({ rect: { x, y, width: w, height: h }, stroked: true, filled: false, lightFill: false, round: false });
const phrase = (text: string, x: number, baseline: number, width: number, fontSize = 9) => ({ text, rect: { x, y: baseline - fontSize * 0.8, width, height: fontSize }, fontSize, rtl: false });

describe('visual stage', () => {
  it('joins rules drawn in pieces', () => {
    const m = mergeCollinear(
      [
        { x1: 50, y1: 100, x2: 120, y2: 100, thickness: 0.6 },
        { x1: 120.5, y1: 100.2, x2: 200, y2: 100.2, thickness: 0.6 },
      ],
      'h',
    );
    expect(m).toHaveLength(1);
    expect(m[0]!.x2).toBe(200);
  });

  it('labels an underline from the text before it', () => {
    const { candidates } = detectVisual(page({ hLines: [{ x1: 100, y1: 101, x2: 300, y2: 101, thickness: 0.6 }] }), [phrase('Email', 70, 100, 24)]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.label).toBe('Email');
    expect(candidates[0]!.rect.y + candidates[0]!.rect.height).toBeCloseTo(101);
  });

  it('ignores a page-wide rule under a heading', () => {
    const { candidates } = detectVisual(page({ hLines: [{ x1: 54, y1: 82, x2: 558, y2: 82, thickness: 0.6 }] }), [phrase('Ostrander & Vale', 54, 80, 120, 11)]);
    expect(candidates).toEqual([]);
  });

  it('turns a row of touching squares into one comb field, not checkboxes', () => {
    const cells = Array.from({ length: 6 }, (_, i) => box(130 + i * 14, 160, 14, 14));
    const { candidates } = detectVisual(page({ boxes: cells }), [phrase('Postcode', 70, 171, 40)]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.kind).toBe('text');
    expect(candidates[0]!.rect.width).toBeGreaterThan(80);
    expect(candidates[0]!.label).toBe('Postcode');
  });

  it('labels a check square with its option text and the question', () => {
    const { candidates } = detectVisual(page({ boxes: [box(230, 610, 9, 9)] }), [phrase('Do you smoke?', 54, 618, 80), phrase('Yes', 243, 618, 16)]);
    expect(candidates[0]!.kind).toBe('checkbox');
    expect(candidates[0]!.label).toBe('Do you smoke? — Yes');
  });

  it('flags boxes holding office-use text as zones, not fields', () => {
    const r = detectVisual(page({ boxes: [box(54, 600, 500, 64)] }), [phrase('FOR OFFICE USE ONLY', 62, 614, 90)]);
    expect(r.candidates).toEqual([]);
    expect(r.officeZones).toHaveLength(1);
  });
});

describe('reading order', () => {
  const at = (x: number, y: number) => ({ rect: { x, y, width: 10, height: 10 } });
  it('goes row by row, left to right — or right to left for RTL pages', () => {
    const items = [at(300, 100), at(50, 101), at(50, 140)];
    expect(readingOrder(items, false).map((i) => i.rect.x)).toEqual([50, 300, 50]);
    expect(readingOrder(items, true).map((i) => i.rect.x)).toEqual([300, 50, 50]);
  });
});
