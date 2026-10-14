/**
 * Coordinate model
 * ================
 *
 * FormFlow uses three coordinate spaces:
 *
 * 1. **PDF user space** — the page's native coordinate system as written in the file.
 *    Units are PDF points (1/72 inch), the origin is wherever the page's view box
 *    (CropBox ∩ MediaBox) puts it, and the y axis points *up*. The page's /Rotate
 *    entry is not applied.
 *
 * 2. **Display space** — what the user sees, at 100% scale. Units are still PDF
 *    points, but the origin is the top-left corner of the *visible, rotated* page and
 *    the y axis points *down*. All annotations and detected fields are stored in this
 *    space. It is independent of zoom, scroll position, device pixel ratio and window
 *    size, so the model never has to change when the view does.
 *
 * 3. **Screen space** — CSS pixels relative to a page element on screen:
 *    `screen = display * scale`, where `scale` is CSS pixels per PDF point.
 *    Canvas backing stores additionally multiply by devicePixelRatio; that never
 *    leaks into model coordinates.
 *
 * The display<->user transform is the same affine matrix pdf.js uses for a
 * `PageViewport` at scale 1 (see pdf.js `PageViewport` constructor), so rendering,
 * text extraction, detection and export all agree on where a point lies.
 */

export type Matrix = readonly [number, number, number, number, number, number];

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Axis-aligned rectangle, top-left origin (display or screen space). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** [x0, y0, x1, y1] in PDF user space, as found in PDF arrays like /Rect or /CropBox. */
export type PdfBox = readonly [number, number, number, number];

export type PageRotation = 0 | 90 | 180 | 270;

export interface PageGeometry {
  index: number;
  /** View box in user space (pdf.js `page.view`: CropBox clipped to MediaBox). */
  view: PdfBox;
  rotation: PageRotation;
  /** Display size in points (after rotation). */
  width: number;
  height: number;
  /** user -> display */
  toDisplay: Matrix;
  /** display -> user */
  toUser: Matrix;
}

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** CSS pixels per PDF point at "100%" zoom (96 dpi screen / 72 dpi PDF). */
export const CSS_PX_PER_PT = 96 / 72;

export function normalizeRotation(rotate: number): PageRotation {
  const r = (((Math.round(rotate / 90) * 90) % 360) + 360) % 360;
  return r as PageRotation;
}

export function applyMatrix(m: Matrix, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

/** Applies only the linear part of a matrix (for direction vectors). */
export function applyMatrixToVector(m: Matrix, v: Point): Point {
  return { x: m[0] * v.x + m[2] * v.y, y: m[1] * v.x + m[3] * v.y };
}

export function multiplyMatrices(a: Matrix, b: Matrix): Matrix {
  // Returns a·b, i.e. applying `b` first, then `a` (pdf.js Util.transform order is the reverse).
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

export function invertMatrix(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) throw new Error('Matrix is not invertible');
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

/**
 * The user->display matrix for a page, identical to pdf.js
 * `new PageViewport({ viewBox, scale: 1, rotation })`.
 */
export function viewportMatrix(view: PdfBox, rotation: PageRotation): Matrix {
  const [x0, y0, x1, y1] = view;
  const cx = (x1 + x0) / 2;
  const cy = (y1 + y0) / 2;
  let a: number, b: number, c: number, d: number;
  switch (rotation) {
    case 90:
      [a, b, c, d] = [0, 1, 1, 0];
      break;
    case 180:
      [a, b, c, d] = [-1, 0, 0, 1];
      break;
    case 270:
      [a, b, c, d] = [0, -1, -1, 0];
      break;
    default:
      [a, b, c, d] = [1, 0, 0, -1];
  }
  let offX: number, offY: number;
  if (a === 0) {
    offX = Math.abs(cy - y0);
    offY = Math.abs(cx - x0);
  } else {
    offX = Math.abs(cx - x0);
    offY = Math.abs(cy - y0);
  }
  return [a, b, c, d, offX - a * cx - c * cy, offY - b * cx - d * cy];
}

export function createPageGeometry(index: number, view: PdfBox, rotate: number): PageGeometry {
  const rotation = normalizeRotation(rotate);
  const w = Math.abs(view[2] - view[0]);
  const h = Math.abs(view[3] - view[1]);
  const swapped = rotation === 90 || rotation === 270;
  const toDisplay = viewportMatrix(view, rotation);
  return {
    index,
    view,
    rotation,
    width: swapped ? h : w,
    height: swapped ? w : h,
    toDisplay,
    toUser: invertMatrix(toDisplay),
  };
}

export function userToDisplay(geom: PageGeometry, p: Point): Point {
  return applyMatrix(geom.toDisplay, p);
}

export function displayToUser(geom: PageGeometry, p: Point): Point {
  return applyMatrix(geom.toUser, p);
}

/** Converts a PDF /Rect-style box in user space to a display-space rectangle. */
export function userBoxToDisplayRect(geom: PageGeometry, box: PdfBox): Rect {
  const p1 = userToDisplay(geom, { x: box[0], y: box[1] });
  const p2 = userToDisplay(geom, { x: box[2], y: box[3] });
  return rectFromPoints(p1, p2);
}

/** Converts a display-space rectangle to a normalized [x0,y0,x1,y1] user-space box. */
export function displayRectToUserBox(geom: PageGeometry, r: Rect): PdfBox {
  const p1 = displayToUser(geom, { x: r.x, y: r.y });
  const p2 = displayToUser(geom, { x: r.x + r.width, y: r.y + r.height });
  return [Math.min(p1.x, p2.x), Math.min(p1.y, p2.y), Math.max(p1.x, p2.x), Math.max(p1.y, p2.y)];
}

/**
 * Angle (degrees, counter-clockwise, as used by pdf-lib's `rotate` option) of the
 * display +x axis expressed in user space. Drawing text/images in user space with
 * this rotation makes them appear upright to the reader of a rotated page.
 */
export function displayUprightAngle(geom: PageGeometry): number {
  const v = applyMatrixToVector(geom.toUser, { x: 1, y: 0 });
  const deg = (Math.atan2(v.y, v.x) * 180) / Math.PI;
  return ((Math.round(deg) % 360) + 360) % 360;
}

export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

// ---------------------------------------------------------------------------
// Display <-> screen
// ---------------------------------------------------------------------------

export function displayToScreen(p: Point, scale: number): Point {
  return { x: p.x * scale, y: p.y * scale };
}

export function displayRectToScreen(r: Rect, scale: number): Rect {
  return { x: r.x * scale, y: r.y * scale, width: r.width * scale, height: r.height * scale };
}

/**
 * Converts a pointer position (client/viewport CSS pixels) into display space for a
 * page element whose bounding client rect is `pageClientRect`. Scrolling, page
 * offsets and window resizing are all captured by the element's live client rect.
 */
export function clientToDisplay(
  clientX: number,
  clientY: number,
  pageClientRect: { left: number; top: number },
  scale: number,
): Point {
  return { x: (clientX - pageClientRect.left) / scale, y: (clientY - pageClientRect.top) / scale };
}

/** Canvas backing-store size for a page at a given CSS scale and device pixel ratio. */
export function canvasPixelSize(
  geom: Size,
  scale: number,
  devicePixelRatio: number,
  maxPixels = 16_777_216,
): { width: number; height: number; outputScale: number } {
  let outputScale = devicePixelRatio;
  const cssW = geom.width * scale;
  const cssH = geom.height * scale;
  const pixels = cssW * cssH * outputScale * outputScale;
  if (pixels > maxPixels) outputScale = Math.sqrt(maxPixels / (cssW * cssH));
  return {
    width: Math.max(1, Math.floor(cssW * outputScale)),
    height: Math.max(1, Math.floor(cssH * outputScale)),
    outputScale,
  };
}

// ---------------------------------------------------------------------------
// Rect helpers
// ---------------------------------------------------------------------------

export function rectCenter(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

export function rectContains(r: Rect, p: Point, tolerance = 0): boolean {
  return (
    p.x >= r.x - tolerance &&
    p.x <= r.x + r.width + tolerance &&
    p.y >= r.y - tolerance &&
    p.y <= r.y + r.height + tolerance
  );
}

export function rectIntersection(a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width);
  const y1 = Math.min(a.y + a.height, b.y + b.height);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function rectArea(r: Rect): number {
  return Math.max(0, r.width) * Math.max(0, r.height);
}

export function rectIoU(a: Rect, b: Rect): number {
  const i = rectIntersection(a, b);
  if (!i) return 0;
  const inter = rectArea(i);
  return inter / (rectArea(a) + rectArea(b) - inter);
}

/** Fraction of `a` covered by `b`. */
export function rectCoverage(a: Rect, b: Rect): number {
  const i = rectIntersection(a, b);
  if (!i) return 0;
  const area = rectArea(a);
  return area === 0 ? 0 : rectArea(i) / area;
}

export function rectUnion(a: Rect, b: Rect): Rect {
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.width, b.x + b.width);
  const y1 = Math.max(a.y + a.height, b.y + b.height);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function inflateRect(r: Rect, dx: number, dy = dx): Rect {
  return { x: r.x - dx, y: r.y - dy, width: r.width + dx * 2, height: r.height + dy * 2 };
}

/** Moves a rect so it lies inside `bounds` (shrinking only if it is larger). */
export function clampRectInto(r: Rect, bounds: Size): Rect {
  const width = Math.min(r.width, bounds.width);
  const height = Math.min(r.height, bounds.height);
  return {
    x: Math.min(Math.max(r.x, 0), bounds.width - width),
    y: Math.min(Math.max(r.y, 0), bounds.height - height),
    width,
    height,
  };
}

export function roundRect(r: Rect, precision = 100): Rect {
  const q = (n: number) => Math.round(n * precision) / precision;
  return { x: q(r.x), y: q(r.y), width: q(r.width), height: q(r.height) };
}
