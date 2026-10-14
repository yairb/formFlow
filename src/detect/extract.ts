import { applyMatrix, multiplyMatrices, type Matrix, type PageGeometry, type Point } from '@/pdf/geometry';
import { pdfjs, type PDFPageProxy } from '@/pdf/pdfjs';
import { containsRtl, toLogicalOrder } from '@/text/bidi';
import type { PageContent, TextRun } from './primitives';

/**
 * Reads a page's text and vector graphics through pdf.js and reduces them to
 * display-space primitives. pdf.js parses the content stream in its worker; this
 * module only interprets the resulting operator list (transforms and paths).
 */

const { OPS } = pdfjs;

/** pdf.js DrawOPS codes inside `constructPath` path data. */
const MOVE = 0;
const LINE = 1;
const CURVE = 2;
const QUAD = 3;
const CLOSE = 4;

const AXIS_TOLERANCE = 0.35;
const MAX_LINE_THICKNESS = 2.5;

// Annotations are excluded: native widgets are read separately (stage 1), and their
// appearance streams would otherwise look like drawn boxes.
export async function extractPageContent(page: PDFPageProxy, geom: PageGeometry): Promise<PageContent> {
  const [text, ops] = await Promise.all([page.getTextContent({ disableNormalization: false }), page.getOperatorList({ intent: 'display', annotationMode: pdfjs.AnnotationMode.DISABLE })]);
  const content: PageContent = {
    pageIndex: geom.index,
    width: geom.width,
    height: geom.height,
    texts: readText(text.items as unknown[], geom),
    hLines: [],
    vLines: [],
    boxes: [],
    imageCoverage: 0,
  };
  readGraphics(ops.fnArray, ops.argsArray, geom, content);
  return content;
}

interface PdfjsTextItem {
  str: string;
  dir?: string;
  transform: number[];
  width: number;
  height: number;
}

function readText(items: unknown[], geom: PageGeometry): TextRun[] {
  const out: TextRun[] = [];
  for (const raw of items) {
    const item = raw as PdfjsTextItem;
    if (typeof item.str !== 'string' || !item.str.trim() || !Array.isArray(item.transform)) continue;
    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = item.transform;
    const fontSize = Math.hypot(c, d) || Math.hypot(a, b);
    if (fontSize <= 0) continue;
    // Baseline direction in display space; only (near) upright text is used.
    const origin = applyMatrix(geom.toDisplay, { x: e, y: f });
    const ahead = applyMatrix(geom.toDisplay, { x: e + a, y: f + b });
    const dx = ahead.x - origin.x;
    const dy = ahead.y - origin.y;
    if (dx <= 0 || Math.abs(dy) > Math.abs(dx) * 0.1) continue;
    const width = Math.max(item.width, 0.1);
    const height = item.height > 0 ? item.height : fontSize;
    out.push({
      str: item.str,
      rect: { x: origin.x, y: origin.y - height * 0.8, width, height },
      fontSize: height,
      rtl: item.dir === 'rtl' || containsRtl(item.str),
    });
  }
  const logical = toLogicalOrder(out.map((t) => t.str));
  out.forEach((t, i) => (t.str = logical[i]!));
  return out;
}

interface GraphicsState {
  ctm: Matrix;
  lineWidth: number;
  fillLight: boolean;
}

function readGraphics(fnArray: number[], argsArray: unknown[][], geom: PageGeometry, out: PageContent): void {
  const stack: GraphicsState[] = [];
  let gs: GraphicsState = { ctm: geom.toDisplay, lineWidth: 1, fillLight: false };
  let imageArea = 0;

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i] ?? [];
    switch (fn) {
      case OPS.save:
        stack.push({ ...gs });
        break;
      case OPS.restore:
        gs = stack.pop() ?? gs;
        break;
      case OPS.transform:
        gs = { ...gs, ctm: multiplyMatrices(gs.ctm, args as unknown as Matrix) };
        break;
      case OPS.paintFormXObjectBegin: {
        stack.push({ ...gs });
        const m = args[0] as unknown as Matrix | null;
        if (Array.isArray(m) || ArrayBuffer.isView(m)) gs = { ...gs, ctm: multiplyMatrices(gs.ctm, Array.from(m as ArrayLike<number>) as unknown as Matrix) };
        break;
      }
      case OPS.paintFormXObjectEnd:
        gs = stack.pop() ?? gs;
        break;
      case OPS.setLineWidth:
        gs = { ...gs, lineWidth: Number(args[0]) || 0 };
        break;
      case OPS.setFillRGBColor:
        gs = { ...gs, fillLight: isLightColor(args) };
        break;
      case OPS.setFillGray:
        gs = { ...gs, fillLight: Number(args[0]) > 0.92 };
        break;
      case OPS.constructPath:
        readPath(args, gs, out);
        break;
      case OPS.paintImageXObject:
      case OPS.paintInlineImageXObject:
      case OPS.paintImageMaskXObject:
      case OPS.paintImageXObjectRepeat: {
        const pts = [applyMatrix(gs.ctm, { x: 0, y: 0 }), applyMatrix(gs.ctm, { x: 1, y: 0 }), applyMatrix(gs.ctm, { x: 0, y: 1 }), applyMatrix(gs.ctm, { x: 1, y: 1 })];
        const xs = pts.map((p) => clamp(p.x, 0, geom.width));
        const ys = pts.map((p) => clamp(p.y, 0, geom.height));
        imageArea += (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
        break;
      }
      default:
        break;
    }
  }
  out.imageCoverage = Math.min(1, imageArea / Math.max(1, geom.width * geom.height));
}

function isLightColor(args: unknown[]): boolean {
  const v = args[0];
  if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) {
    const n = parseInt(v.slice(1), 16);
    return ((n >> 16) & 255) > 238 && ((n >> 8) & 255) > 238 && (n & 255) > 238;
  }
  if (args.length >= 3 && args.every((x) => typeof x === 'number')) {
    const [r, g, b] = args as number[];
    const s = Math.max(r!, g!, b!) > 1 ? 255 : 1;
    return r! / s > 0.93 && g! / s > 0.93 && b! / s > 0.93;
  }
  return false;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

type PaintKind = 'stroke' | 'fill' | 'both' | 'none';

function paintKind(op: number): PaintKind {
  switch (op) {
    case OPS.stroke:
    case OPS.closeStroke:
      return 'stroke';
    case OPS.fill:
    case OPS.eoFill:
      return 'fill';
    case OPS.fillStroke:
    case OPS.eoFillStroke:
    case OPS.closeFillStroke:
    case OPS.closeEOFillStroke:
      return 'both';
    default:
      return 'none';
  }
}

/** Finds the path data in `constructPath` arguments (`[paintOp, [data], minMax]` in pdf.js 5). */
function pathData(args: unknown[]): ArrayLike<number> | null {
  const holder = args[1];
  if (Array.isArray(holder)) {
    const d = holder[0];
    if (d && (ArrayBuffer.isView(d) || Array.isArray(d))) return d as ArrayLike<number>;
  }
  return null;
}

interface Subpath {
  points: Point[];
  curved: boolean;
  closed: boolean;
}

function readPath(args: unknown[], gs: GraphicsState, out: PageContent): void {
  const paint = paintKind(Number(args[0]));
  if (paint === 'none') return;
  const data = pathData(args);
  if (!data) return;

  const subpaths: Subpath[] = [];
  let cur: Subpath | null = null;
  const to = (x: number, y: number) => applyMatrix(gs.ctm, { x, y });
  for (let i = 0; i < data.length; ) {
    const code = data[i++];
    if (code === MOVE) {
      cur = { points: [to(data[i]!, data[i + 1]!)], curved: false, closed: false };
      subpaths.push(cur);
      i += 2;
    } else if (code === LINE) {
      if (!cur) subpaths.push((cur = { points: [], curved: false, closed: false }));
      cur.points.push(to(data[i]!, data[i + 1]!));
      i += 2;
    } else if (code === CURVE) {
      if (cur) {
        cur.curved = true;
        cur.points.push(to(data[i]!, data[i + 1]!), to(data[i + 2]!, data[i + 3]!), to(data[i + 4]!, data[i + 5]!));
      }
      i += 6;
    } else if (code === QUAD) {
      if (cur) {
        cur.curved = true;
        cur.points.push(to(data[i]!, data[i + 1]!), to(data[i + 2]!, data[i + 3]!));
      }
      i += 4;
    } else if (code === CLOSE) {
      if (cur) cur.closed = true;
    } else {
      return; // Unknown encoding: ignore the path rather than misread it.
    }
  }

  // Stroke thickness in display units (CTM scale applied).
  const scale = Math.sqrt(Math.abs(gs.ctm[0] * gs.ctm[3] - gs.ctm[1] * gs.ctm[2]));
  const thickness = Math.max(0.1, gs.lineWidth * scale);
  const stroked = paint === 'stroke' || paint === 'both';
  const filled = paint === 'fill' || paint === 'both';

  for (const sp of subpaths) {
    if (sp.points.length < 2) continue;
    const xs = sp.points.map((p) => p.x);
    const ys = sp.points.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const w = maxX - minX;
    const h = maxY - minY;

    if (sp.curved) {
      // Small closed round outline: radio button / circle.
      if (sp.closed || isClosedLoop(sp.points)) {
        if (w > 3 && h > 3 && Math.abs(w - h) < Math.max(w, h) * 0.25) {
          out.boxes.push({ rect: { x: minX, y: minY, width: w, height: h }, stroked, filled, lightFill: filled && gs.fillLight, round: true });
        }
      }
      continue;
    }

    const rectLike = isAxisRect(sp.points);
    if (rectLike && filled && !stroked) {
      // Filled thin rectangles are how many generators draw rules.
      if (h <= MAX_LINE_THICKNESS && w > 4) {
        out.hLines.push({ x1: minX, y1: minY + h / 2, x2: maxX, y2: minY + h / 2, thickness: Math.max(h, 0.1) });
        continue;
      }
      if (w <= MAX_LINE_THICKNESS && h > 4) {
        out.vLines.push({ x1: minX + w / 2, y1: minY, x2: minX + w / 2, y2: maxY, thickness: Math.max(w, 0.1) });
        continue;
      }
    }
    if (rectLike && w > 2 && h > 2) {
      out.boxes.push({ rect: { x: minX, y: minY, width: w, height: h }, stroked, filled, lightFill: filled && gs.fillLight, round: false });
      if (stroked) pushRectEdges(out, minX, minY, maxX, maxY, thickness);
      continue;
    }
    if (!stroked) continue;
    for (let k = 1; k < sp.points.length; k++) pushSegment(out, sp.points[k - 1]!, sp.points[k]!, thickness);
    if (sp.closed) pushSegment(out, sp.points[sp.points.length - 1]!, sp.points[0]!, thickness);
  }
}

function isClosedLoop(points: Point[]): boolean {
  const a = points[0]!;
  const b = points[points.length - 1]!;
  return Math.hypot(a.x - b.x, a.y - b.y) < 0.5;
}

/** Four (or five, closing) points forming an axis-aligned rectangle. */
function isAxisRect(points: Point[]): boolean {
  let pts = points;
  if (pts.length === 5 && isClosedLoop(pts)) pts = pts.slice(0, 4);
  if (pts.length !== 4) return false;
  for (let k = 0; k < 4; k++) {
    const p = pts[k]!;
    const q = pts[(k + 1) % 4]!;
    if (Math.abs(p.x - q.x) > AXIS_TOLERANCE && Math.abs(p.y - q.y) > AXIS_TOLERANCE) return false;
  }
  return true;
}

function pushRectEdges(out: PageContent, x0: number, y0: number, x1: number, y1: number, t: number): void {
  // Box edges are kept as segments too, so tables drawn as cell rectangles form a grid.
  out.hLines.push({ x1: x0, y1: y0, x2: x1, y2: y0, thickness: t, fromBox: true });
  out.hLines.push({ x1: x0, y1: y1, x2: x1, y2: y1, thickness: t, fromBox: true });
  out.vLines.push({ x1: x0, y1: y0, x2: x0, y2: y1, thickness: t, fromBox: true });
  out.vLines.push({ x1: x1, y1: y0, x2: x1, y2: y1, thickness: t, fromBox: true });
}

function pushSegment(out: PageContent, a: Point, b: Point, thickness: number): void {
  if (thickness > MAX_LINE_THICKNESS * 2) return;
  if (Math.abs(a.y - b.y) <= AXIS_TOLERANCE && Math.abs(a.x - b.x) > 2) {
    const y = (a.y + b.y) / 2;
    out.hLines.push({ x1: Math.min(a.x, b.x), y1: y, x2: Math.max(a.x, b.x), y2: y, thickness });
  } else if (Math.abs(a.x - b.x) <= AXIS_TOLERANCE && Math.abs(a.y - b.y) > 2) {
    const x = (a.x + b.x) / 2;
    out.vLines.push({ x1: x, y1: Math.min(a.y, b.y), x2: x, y2: Math.max(a.y, b.y), thickness });
  }
}
