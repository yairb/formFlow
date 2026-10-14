import type { Rect } from '@/pdf/geometry';

/**
 * Page content reduced to the primitives field detection reasons about. Everything
 * is in display space (PDF points, top-left origin, page rotation applied), so the
 * detection stages never deal with PDF coordinate systems.
 */

export interface TextRun {
  str: string;
  rect: Rect;
  fontSize: number;
  rtl: boolean;
}

/** An axis-aligned stroke. For horizontal segments y1 === y2 and x1 < x2. */
export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Stroke thickness in points. */
  thickness: number;
  /** Edge of a stroked rectangle (box outline) rather than a standalone rule. */
  fromBox?: boolean;
}

export interface PathBox {
  rect: Rect;
  stroked: boolean;
  filled: boolean;
  /** Fill is near-white (a "paper" box rather than a tinted band). */
  lightFill: boolean;
  /** Closed curved outline (circle / ellipse), e.g. a radio button. */
  round: boolean;
}

export interface PageContent {
  pageIndex: number;
  width: number;
  height: number;
  texts: TextRun[];
  hLines: Segment[];
  vLines: Segment[];
  boxes: PathBox[];
  /** Area covered by raster images, as a fraction of the page. */
  imageCoverage: number;
}

export function segLength(s: Segment): number {
  return Math.max(Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1));
}

export function rectRight(r: Rect): number {
  return r.x + r.width;
}

export function rectBottom(r: Rect): number {
  return r.y + r.height;
}

export function overlap1d(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

export function intersectionArea(a: Rect, b: Rect): number {
  return overlap1d(a.x, rectRight(a), b.x, rectRight(b)) * overlap1d(a.y, rectBottom(a), b.y, rectBottom(b));
}

export function iou(a: Rect, b: Rect): number {
  const i = intersectionArea(a, b);
  const u = a.width * a.height + b.width * b.height - i;
  return u > 0 ? i / u : 0;
}

export function containsRect(outer: Rect, inner: Rect, tolerance = 0): boolean {
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    rectRight(inner) <= rectRight(outer) + tolerance &&
    rectBottom(inner) <= rectBottom(outer) + tolerance
  );
}

export function centerOf(r: Rect): { x: number; y: number } {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}
