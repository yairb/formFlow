import type { Point, Rect, Size } from '@/pdf/geometry';

/**
 * Pure workspace geometry: where each page sits inside the scrollable content at
 * a given scale. Everything here is in CSS pixels of the scroll content
 * ("content space"); a page's display-space point d is at
 * `slot.left + d.x * scale, slot.top + d.y * scale`.
 */
export const PAGE_GAP = 20;
/** Leaves room for the floating toolbar above and the zoom pill below the pages. */
export const PAD_Y = 64;
export const PAD_X = 28;

export interface PageSlot {
  index: number;
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface WorkspaceLayout {
  scale: number;
  slots: PageSlot[];
  width: number;
  height: number;
}

export function layoutPages(pages: readonly Size[], scale: number, viewportWidth: number): WorkspaceLayout {
  let maxW = 0;
  for (const p of pages) maxW = Math.max(maxW, p.width * scale);
  const width = Math.max(viewportWidth, Math.ceil(maxW + PAD_X * 2));
  const slots: PageSlot[] = [];
  let top = PAD_Y;
  pages.forEach((p, index) => {
    const w = p.width * scale;
    const h = p.height * scale;
    slots.push({ index, top, left: Math.round((width - w) / 2), width: w, height: h });
    top += h + PAGE_GAP;
  });
  const height = pages.length ? top - PAGE_GAP + PAD_Y : 0;
  return { scale, slots, width, height };
}

export function fitScale(pages: readonly Size[], mode: 'fit-width' | 'fit-page', viewport: Size, pageIndex = 0): number {
  if (pages.length === 0) return 1;
  const availW = Math.max(80, viewport.width - PAD_X * 2);
  const availH = Math.max(80, viewport.height - PAD_Y * 2);
  if (mode === 'fit-width') {
    const maxW = pages.reduce((m, p) => Math.max(m, p.width), 0);
    return availW / maxW;
  }
  const p = pages[Math.min(pageIndex, pages.length - 1)]!;
  return Math.min(availW / p.width, availH / p.height);
}

/** First and last page index intersecting [top - overscan, top + height + overscan]. */
export function visibleRange(slots: readonly PageSlot[], top: number, height: number, overscan = 0): [number, number] {
  if (slots.length === 0) return [0, -1];
  const y0 = top - overscan;
  const y1 = top + height + overscan;
  let lo = 0;
  let hi = slots.length - 1;
  // First slot whose bottom is below y0.
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const s = slots[mid]!;
    if (s.top + s.height < y0) lo = mid + 1;
    else hi = mid;
  }
  const first = lo;
  let last = first;
  while (last + 1 < slots.length && slots[last + 1]!.top <= y1) last++;
  return [first, last];
}

/** Page with the largest visible height (the "current page"). */
export function mostVisiblePage(slots: readonly PageSlot[], top: number, height: number): number {
  const [first, last] = visibleRange(slots, top, height);
  let best = first;
  let bestH = -1;
  for (let i = first; i <= last; i++) {
    const s = slots[i]!;
    const h = Math.min(s.top + s.height, top + height) - Math.max(s.top, top);
    if (h > bestH + 0.5) {
      bestH = h;
      best = i;
    }
  }
  return Math.max(0, best);
}

/** Display-space rect on a page → content-space rect. */
export function pageRectToContent(slot: PageSlot, scale: number, r: Rect): Rect {
  return { x: slot.left + r.x * scale, y: slot.top + r.y * scale, width: r.width * scale, height: r.height * scale };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}

/**
 * Scroll position that brings `rect` (display space on the slot's page) to the
 * center of the viewport, or the page top into view when no rect is given.
 * Rects taller than the viewport are aligned to the top with a margin instead.
 */
export function scrollToReveal(
  layout: WorkspaceLayout,
  pageIndex: number,
  rect: Rect | undefined,
  viewport: Size,
  current: Point,
): Point {
  const slot = layout.slots[pageIndex];
  if (!slot) return current;
  const maxLeft = layout.width - viewport.width;
  const maxTop = layout.height - viewport.height;
  if (!rect) return { x: clamp(current.x, 0, maxLeft), y: clamp(slot.top - PAD_Y / 2, 0, maxTop) };
  const c = pageRectToContent(slot, layout.scale, rect);
  const margin = 48;
  const top = c.height > viewport.height - margin * 2 ? c.y - margin : c.y + c.height / 2 - viewport.height / 2;
  let left = current.x;
  if (c.x < current.x + margin || c.x + c.width > current.x + viewport.width - margin) {
    left = c.width > viewport.width - margin * 2 ? c.x - margin : c.x + c.width / 2 - viewport.width / 2;
  }
  return { x: clamp(left, 0, maxLeft), y: clamp(top, 0, maxTop) };
}

/** Locates the page and display point under a content-space point (nearest page vertically). */
export function contentToPagePoint(layout: WorkspaceLayout, p: Point): { pageIndex: number; point: Point } | null {
  const { slots, scale } = layout;
  if (slots.length === 0) return null;
  let idx = visibleRange(slots, p.y, 0)[0];
  const s0 = slots[idx]!;
  // In the gap above a page: pick the closer of the two neighbours.
  if (p.y < s0.top && idx > 0) {
    const prev = slots[idx - 1]!;
    if (p.y - (prev.top + prev.height) < s0.top - p.y) idx--;
  }
  const s = slots[idx]!;
  return { pageIndex: idx, point: { x: (p.x - s.left) / scale, y: (p.y - s.top) / scale } };
}

/**
 * New scroll position after a zoom so that the document point under `anchor`
 * (viewport-relative CSS px) stays under it.
 */
export function anchoredScroll(before: WorkspaceLayout, after: WorkspaceLayout, scroll: Point, anchor: Point): Point {
  const hit = contentToPagePoint(before, { x: scroll.x + anchor.x, y: scroll.y + anchor.y });
  if (!hit) return scroll;
  const s = after.slots[hit.pageIndex];
  if (!s) return scroll;
  return {
    x: s.left + hit.point.x * after.scale - anchor.x,
    y: s.top + hit.point.y * after.scale - anchor.y,
  };
}

/** Next zoom step for zoom in/out buttons and shortcuts. */
const STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
export function zoomStep(scale: number, direction: 1 | -1): number {
  // Steps are in "percent of 100%" where 100% = 96/72 CSS px per point.
  const pct = scale / (96 / 72);
  const next = direction === 1 ? STEPS.find((s) => s > pct + 0.001) : [...STEPS].reverse().find((s) => s < pct - 0.001);
  return (next ?? (direction === 1 ? STEPS[STEPS.length - 1]! : STEPS[0]!)) * (96 / 72);
}
