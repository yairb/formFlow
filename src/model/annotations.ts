import type { Point, Rect, Size } from '@/pdf/geometry';
import { clampRectInto } from '@/pdf/geometry';
import { getSharedFontLibrary, type FontLibrary } from '@/text/fonts';
import { layoutText, measureWith, type TextLayout } from '@/text/layout';
import { lineHeightPt } from '@/text/metrics';
import { newId } from './ids';
import type {
  Annotation,
  AnnotationId,
  DocModel,
  HighlightAnnotation,
  InkAnnotation,
  InkStroke,
  MarkAnnotation,
  MarkKind,
  SignatureAnnotation,
  SignatureImage,
  TextAnnotation,
} from './types';

export const DEFAULT_TEXT_COLOR = '#111827';
export const DEFAULT_INK_COLOR = '#1d2a6b';
export const MIN_TEXT_WIDTH_EM = 0.6;
export const MIN_ANNOTATION_SIZE = 4;

// ---------------------------------------------------------------------------
// Text layout for annotations
// ---------------------------------------------------------------------------

export function layoutTextAnnotation(
  a: Pick<TextAnnotation, 'text' | 'fontSize' | 'fontFamily' | 'bold' | 'autoWidth' | 'rect'>,
  lib: FontLibrary = getSharedFontLibrary(),
): TextLayout {
  const style = { family: a.fontFamily, bold: a.bold, size: a.fontSize };
  return layoutText(a.text, style, a.autoWidth ? null : a.rect.width, measureWith(lib, style));
}

/** Recomputes a text annotation's box from its content. */
export function fitTextAnnotation<T extends TextAnnotation>(a: T, lib?: FontLibrary): T {
  const layout = layoutTextAnnotation(a, lib);
  const minWidth = a.fontSize * MIN_TEXT_WIDTH_EM;
  const width = a.autoWidth ? Math.max(minWidth, Math.ceil(layout.contentWidth * 100) / 100 + 0.5) : a.rect.width;
  const height = Math.max(lineHeightPt(a.fontSize), layout.height);
  if (width === a.rect.width && height === a.rect.height) return a;
  return { ...a, rect: { ...a.rect, width, height } };
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

export interface TextDefaults {
  fontSize: number;
  fontFamily: TextAnnotation['fontFamily'];
  color: string;
  bold?: boolean;
}

/**
 * Creates a text annotation whose first line is vertically centered on `at`,
 * with its left edge (or right edge for `align: right`) at `at.x`.
 */
export function createTextAnnotation(
  pageIndex: number,
  at: Point,
  defaults: TextDefaults,
  extra: Partial<TextAnnotation> = {},
): TextAnnotation {
  const lh = lineHeightPt(defaults.fontSize);
  const base: TextAnnotation = {
    id: newId('txt'),
    type: 'text',
    pageIndex,
    rect: { x: at.x, y: at.y - lh / 2, width: defaults.fontSize * MIN_TEXT_WIDTH_EM, height: lh },
    text: '',
    fontSize: defaults.fontSize,
    fontFamily: defaults.fontFamily,
    bold: defaults.bold ?? false,
    color: defaults.color,
    align: 'left',
    autoWidth: true,
    ...extra,
  };
  return fitTextAnnotation(base);
}

export function createMarkAnnotation(
  pageIndex: number,
  center: Point,
  mark: MarkKind,
  size: number,
  color: string,
): MarkAnnotation {
  return {
    id: newId('mrk'),
    type: 'mark',
    pageIndex,
    mark,
    color,
    rect: { x: center.x - size / 2, y: center.y - size / 2, width: size, height: size },
  };
}

export function createSignatureAnnotation(
  pageIndex: number,
  rect: Rect,
  image: SignatureImage,
  signatureId?: string,
): SignatureAnnotation {
  return { id: newId('sig'), type: 'signature', pageIndex, rect, image, signatureId };
}

/** Fits an image of the given pixel size into `box`, preserving aspect ratio. */
export function fitImageRect(
  pixelWidth: number,
  pixelHeight: number,
  box: Rect,
  alignX: 'left' | 'center' | 'right' = 'center',
  alignY: 'top' | 'center' | 'bottom' = 'center',
): Rect {
  const ratio = pixelWidth / Math.max(1, pixelHeight);
  let width = box.width;
  let height = width / ratio;
  if (height > box.height) {
    height = box.height;
    width = height * ratio;
  }
  const x =
    alignX === 'left' ? box.x : alignX === 'right' ? box.x + box.width - width : box.x + (box.width - width) / 2;
  const y =
    alignY === 'top' ? box.y : alignY === 'bottom' ? box.y + box.height - height : box.y + (box.height - height) / 2;
  return { x, y, width, height };
}

export function createHighlightAnnotation(pageIndex: number, rect: Rect, color: string): HighlightAnnotation {
  return { id: newId('hl'), type: 'highlight', pageIndex, rect, color, opacity: 0.38 };
}

// ---------------------------------------------------------------------------
// Ink
// ---------------------------------------------------------------------------

export function inkStrokesAbsolute(a: Pick<InkAnnotation, 'rect' | 'strokes'>): Point[][] {
  const { x, y, width, height } = a.rect;
  return a.strokes.map((s) => s.points.map(([u, v]) => ({ x: x + u * width, y: y + v * height })));
}

function normalizeStrokes(strokes: Point[][], strokeWidth: number): { rect: Rect; strokes: InkStroke[] } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of strokes)
    for (const p of s) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
  // Pad by half the stroke width so the rect contains the painted pixels and is never degenerate.
  const pad = strokeWidth / 2;
  x0 -= pad;
  y0 -= pad;
  x1 += pad;
  y1 += pad;
  const width = Math.max(x1 - x0, 1);
  const height = Math.max(y1 - y0, 1);
  return {
    rect: { x: x0, y: y0, width, height },
    strokes: strokes.map((s) => ({
      points: s.map((p) => [round4((p.x - x0) / width), round4((p.y - y0) / height)] as [number, number]),
    })),
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function createInkAnnotation(
  pageIndex: number,
  stroke: Point[],
  color: string,
  strokeWidth: number,
): InkAnnotation {
  const n = normalizeStrokes([stroke], strokeWidth);
  return { id: newId('ink'), type: 'ink', pageIndex, color, strokeWidth, ...n };
}

export function appendInkStroke(a: InkAnnotation, stroke: Point[]): InkAnnotation {
  const all = [...inkStrokesAbsolute(a), stroke];
  return { ...a, ...normalizeStrokes(all, a.strokeWidth) };
}

/** Removes near-duplicate points so stored strokes stay compact. */
export function simplifyStroke(points: Point[], minDistance = 0.6): Point[] {
  if (points.length <= 2) return points;
  const out: Point[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!;
    const last = out[out.length - 1]!;
    if (Math.hypot(p.x - last.x, p.y - last.y) >= minDistance) out.push(p);
  }
  out.push(points[points.length - 1]!);
  return out;
}

// ---------------------------------------------------------------------------
// Model operations (pure)
// ---------------------------------------------------------------------------

export function addAnnotation(m: DocModel, a: Annotation): DocModel {
  return {
    ...m,
    annotations: { ...m.annotations, [a.id]: a },
    annotationOrder: [...m.annotationOrder.filter((id) => id !== a.id), a.id],
  };
}

export function updateAnnotation(
  m: DocModel,
  id: AnnotationId,
  patch: Partial<Annotation> | ((a: Annotation) => Annotation),
): DocModel {
  const current = m.annotations[id];
  if (!current) return m;
  let next = typeof patch === 'function' ? patch(current) : ({ ...current, ...patch } as Annotation);
  if (next.type === 'text') next = fitTextAnnotation(next);
  if (next === current) return m;
  return { ...m, annotations: { ...m.annotations, [id]: next } };
}

export function removeAnnotations(m: DocModel, ids: AnnotationId[]): DocModel {
  if (!ids.some((id) => m.annotations[id])) return m;
  const annotations = { ...m.annotations };
  for (const id of ids) delete annotations[id];
  const remove = new Set(ids);
  return { ...m, annotations, annotationOrder: m.annotationOrder.filter((id) => !remove.has(id)) };
}

export function duplicateAnnotation(
  m: DocModel,
  id: AnnotationId,
  offset: Point,
  pageSize: Size,
): { model: DocModel; id: AnnotationId | null } {
  const a = m.annotations[id];
  if (!a) return { model: m, id: null };
  const copy: Annotation = {
    ...structuredClone(a),
    id: newId(a.type.slice(0, 3)),
    fieldId: undefined,
    rect: clampRectInto({ ...a.rect, x: a.rect.x + offset.x, y: a.rect.y + offset.y }, pageSize),
  };
  delete copy.fieldId;
  return { model: addAnnotation(m, copy), id: copy.id };
}

export function moveAnnotationTo(m: DocModel, id: AnnotationId, rect: Rect, pageSize: Size): DocModel {
  return updateAnnotation(m, id, (a) => ({ ...a, rect: clampRectInto(rect, pageSize) }));
}

export function annotationsOnPage(m: DocModel, pageIndex: number): Annotation[] {
  const out: Annotation[] = [];
  for (const id of m.annotationOrder) {
    const a = m.annotations[id];
    if (a && a.pageIndex === pageIndex) out.push(a);
  }
  return out;
}

export function isEmptyAnnotation(a: Annotation): boolean {
  if (a.type === 'text') return a.text.trim() === '';
  if (a.type === 'ink') return a.strokes.length === 0;
  return false;
}

export function annotationLabel(a: Annotation): string {
  switch (a.type) {
    case 'text':
      return a.date ? 'Date' : 'Text';
    case 'mark':
      return a.mark === 'check' ? 'Checkmark' : a.mark === 'cross' ? 'Cross mark' : 'Dot';
    case 'signature':
      return 'Signature';
    case 'ink':
      return 'Drawing';
    case 'highlight':
      return 'Highlight';
  }
}

// ---------------------------------------------------------------------------
// Resizing
// ---------------------------------------------------------------------------

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export interface ResizeOptions {
  lockAspect: boolean;
  minWidth: number;
  minHeight: number;
  bounds: Size;
}

/**
 * Resizes `start` by dragging `handle` by (dx, dy) display points. The opposite
 * edge/corner stays fixed. With `lockAspect`, corner drags preserve aspect ratio.
 */
export function resizeRect(start: Rect, handle: Handle, dx: number, dy: number, opts: ResizeOptions): Rect {
  let x0 = start.x;
  let y0 = start.y;
  let x1 = start.x + start.width;
  let y1 = start.y + start.height;
  if (handle.includes('w')) x0 = Math.min(x0 + dx, x1 - opts.minWidth);
  if (handle.includes('e')) x1 = Math.max(x1 + dx, x0 + opts.minWidth);
  if (handle.includes('n')) y0 = Math.min(y0 + dy, y1 - opts.minHeight);
  if (handle.includes('s')) y1 = Math.max(y1 + dy, y0 + opts.minHeight);

  // Clamp to page.
  x0 = Math.max(0, x0);
  y0 = Math.max(0, y0);
  x1 = Math.min(opts.bounds.width, x1);
  y1 = Math.min(opts.bounds.height, y1);

  if (opts.lockAspect && handle.length === 2 && start.height > 0) {
    const ratio = start.width / start.height;
    let w = x1 - x0;
    let h = y1 - y0;
    // Follow whichever dimension changed proportionally more.
    if (Math.abs(w / start.width - 1) >= Math.abs(h / start.height - 1)) h = w / ratio;
    else w = h * ratio;
    // Keep within bounds while preserving ratio.
    const maxW = handle.includes('w') ? start.x + start.width : opts.bounds.width - start.x;
    const maxH = handle.includes('n') ? start.y + start.height : opts.bounds.height - start.y;
    const s = Math.min(1, maxW / w, maxH / h);
    w *= s;
    h *= s;
    if (w < opts.minWidth) {
      w = opts.minWidth;
      h = w / ratio;
    }
    if (handle.includes('w')) x0 = start.x + start.width - w;
    else x1 = x0 + w;
    if (handle.includes('n')) y0 = start.y + start.height - h;
    else y1 = y0 + h;
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function handlesFor(a: Annotation): Handle[] {
  switch (a.type) {
    case 'text':
      return ['w', 'e'];
    case 'highlight':
      return ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
    default:
      return ['ne', 'nw', 'se', 'sw'];
  }
}

export function locksAspect(a: Annotation): boolean {
  return a.type === 'mark' || a.type === 'signature' || a.type === 'ink';
}
