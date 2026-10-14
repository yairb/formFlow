import { describe, expect, it } from 'vitest';
import {
  PAD_Y,
  PAGE_GAP,
  anchoredScroll,
  contentToPagePoint,
  fitScale,
  layoutPages,
  mostVisiblePage,
  scrollToReveal,
  visibleRange,
  zoomStep,
} from './layout';

const letter = { width: 612, height: 792 };
const landscape = { width: 792, height: 612 };

describe('workspace layout', () => {
  it('stacks pages vertically and centers each horizontally', () => {
    const l = layoutPages([letter, landscape, letter], 1, 1000);
    expect(l.width).toBe(1000);
    expect(l.slots[0]).toEqual({ index: 0, top: PAD_Y, left: 194, width: 612, height: 792 });
    expect(l.slots[1]!.top).toBe(PAD_Y + 792 + PAGE_GAP);
    expect(l.slots[1]!.left).toBe(104);
    expect(l.height).toBe(PAD_Y * 2 + 792 * 2 + 612 + PAGE_GAP * 2);
    // Content grows wider than the viewport when zoomed in.
    expect(layoutPages([letter], 2, 500).width).toBe(612 * 2 + 56);
  });

  it('computes fit scales', () => {
    expect(fitScale([letter, landscape], 'fit-width', { width: 848, height: 600 })).toBeCloseTo(792 / 792, 9);
    const s = fitScale([letter], 'fit-page', { width: 2000, height: 848 });
    expect(s).toBeCloseTo((848 - PAD_Y * 2) / 792, 9);
  });

  it('finds visible pages with binary search and the most visible page', () => {
    const l = layoutPages(Array(100).fill(letter), 1, 800);
    const pitch = 792 + PAGE_GAP;
    expect(visibleRange(l.slots, 0, 700)).toEqual([0, 0]);
    expect(visibleRange(l.slots, PAD_Y + pitch * 50, 900)).toEqual([50, 51]);
    expect(visibleRange(l.slots, PAD_Y + pitch * 50, 900, 1000)).toEqual([48, 52]);
    expect(mostVisiblePage(l.slots, PAD_Y + pitch * 10 + 600, 800)).toBe(11);
    expect(visibleRange(l.slots, 1e9, 100)).toEqual([99, 99]);
  });

  it('maps content points to pages, choosing the nearer page in gaps', () => {
    const l = layoutPages([letter, letter], 2, 1400);
    const s1 = l.slots[1]!;
    expect(contentToPagePoint(l, { x: s1.left + 20, y: s1.top + 40 })).toEqual({ pageIndex: 1, point: { x: 10, y: 20 } });
    const gapTop = l.slots[0]!.top + l.slots[0]!.height + 2;
    expect(contentToPagePoint(l, { x: 0, y: gapTop })!.pageIndex).toBe(0);
    expect(contentToPagePoint(l, { x: 0, y: s1.top - 2 })!.pageIndex).toBe(1);
  });

  it('keeps the point under the cursor fixed while zooming', () => {
    const pages = [letter, landscape, letter];
    const a = layoutPages(pages, 1, 1000);
    const b = layoutPages(pages, 2.3, 1000);
    const scroll = { x: 0, y: 900 };
    const anchor = { x: 420, y: 300 };
    const before = contentToPagePoint(a, { x: scroll.x + anchor.x, y: scroll.y + anchor.y })!;
    const next = anchoredScroll(a, b, scroll, anchor);
    const after = contentToPagePoint(b, { x: next.x + anchor.x, y: next.y + anchor.y })!;
    expect(after.pageIndex).toBe(before.pageIndex);
    expect(after.point.x).toBeCloseTo(before.point.x, 6);
    expect(after.point.y).toBeCloseTo(before.point.y, 6);
  });

  it('centers a field rect in the viewport, clamped to the content', () => {
    const l = layoutPages(Array(5).fill(letter), 1.5, 1000);
    const vp = { width: 1000, height: 700 };
    const rect = { x: 100, y: 400, width: 200, height: 20 };
    const pos = scrollToReveal(l, 3, rect, vp, { x: 0, y: 0 });
    const s = l.slots[3]!;
    expect(pos.y + vp.height / 2).toBeCloseTo(s.top + (rect.y + rect.height / 2) * 1.5, 6);
    expect(scrollToReveal(l, 0, { x: 0, y: 0, width: 10, height: 10 }, vp, { x: 0, y: 500 }).y).toBe(0);
    expect(scrollToReveal(l, 2, undefined, vp, { x: 0, y: 0 }).y).toBe(l.slots[2]!.top - PAD_Y / 2);
  });

  it('steps through zoom levels', () => {
    const pct = (s: number) => Math.round((s / (96 / 72)) * 100);
    expect(pct(zoomStep(96 / 72, 1))).toBe(110);
    expect(pct(zoomStep(96 / 72, -1))).toBe(90);
    expect(pct(zoomStep(1.05 * (96 / 72), 1))).toBe(110);
    expect(pct(zoomStep(5 * (96 / 72), 1))).toBe(500);
    expect(pct(zoomStep(0.25 * (96 / 72), -1))).toBe(25);
  });
});
