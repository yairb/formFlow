import type { Point } from '@/pdf/geometry';
import type { MarkKind } from './types';

/**
 * Vector path primitives shared by the on-screen SVG renderer and the PDF exporter,
 * so a mark or drawing looks the same in the editor and in the exported file.
 */
export type PathCommand =
  | { op: 'M'; p: Point }
  | { op: 'L'; p: Point }
  | { op: 'Q'; c: Point; p: Point }
  | { op: 'C'; c1: Point; c2: Point; p: Point }
  | { op: 'Z' };

export interface MarkShape {
  /** Paths in a unit square (0..1, y down). */
  paths: PathCommand[][];
  /** Stroke width relative to the mark size; 0 means filled. */
  strokeWidth: number;
  fill: boolean;
}

const K = 0.5522847498; // cubic Bézier circle constant

function circle(cx: number, cy: number, r: number): PathCommand[] {
  const k = K * r;
  return [
    { op: 'M', p: { x: cx + r, y: cy } },
    { op: 'C', c1: { x: cx + r, y: cy + k }, c2: { x: cx + k, y: cy + r }, p: { x: cx, y: cy + r } },
    { op: 'C', c1: { x: cx - k, y: cy + r }, c2: { x: cx - r, y: cy + k }, p: { x: cx - r, y: cy } },
    { op: 'C', c1: { x: cx - r, y: cy - k }, c2: { x: cx - k, y: cy - r }, p: { x: cx, y: cy - r } },
    { op: 'C', c1: { x: cx + k, y: cy - r }, c2: { x: cx + r, y: cy - k }, p: { x: cx + r, y: cy } },
    { op: 'Z' },
  ];
}

export const MARK_SHAPES: Record<MarkKind, MarkShape> = {
  check: {
    paths: [
      [
        { op: 'M', p: { x: 0.15, y: 0.53 } },
        { op: 'L', p: { x: 0.4, y: 0.78 } },
        { op: 'L', p: { x: 0.86, y: 0.22 } },
      ],
    ],
    strokeWidth: 0.13,
    fill: false,
  },
  cross: {
    paths: [
      [
        { op: 'M', p: { x: 0.2, y: 0.2 } },
        { op: 'L', p: { x: 0.8, y: 0.8 } },
      ],
      [
        { op: 'M', p: { x: 0.8, y: 0.2 } },
        { op: 'L', p: { x: 0.2, y: 0.8 } },
      ],
    ],
    strokeWidth: 0.12,
    fill: false,
  },
  dot: { paths: [circle(0.5, 0.5, 0.3)], strokeWidth: 0, fill: true },
};

export function mapPath(path: PathCommand[], f: (p: Point) => Point): PathCommand[] {
  return path.map((c) => {
    switch (c.op) {
      case 'M':
      case 'L':
        return { op: c.op, p: f(c.p) };
      case 'Q':
        return { op: 'Q', c: f(c.c), p: f(c.p) };
      case 'C':
        return { op: 'C', c1: f(c.c1), c2: f(c.c2), p: f(c.p) };
      case 'Z':
        return c;
    }
  });
}

/** Smooth path through stroke samples (quadratic curves through midpoints). */
export function smoothStrokePath(points: Point[]): PathCommand[] {
  if (points.length === 0) return [];
  const first = points[0]!;
  if (points.length === 1) {
    // A tap: draw a tiny segment so round caps render a dot.
    return [
      { op: 'M', p: first },
      { op: 'L', p: { x: first.x + 0.01, y: first.y } },
    ];
  }
  if (points.length === 2) return [{ op: 'M', p: first }, { op: 'L', p: points[1]! }];
  const cmds: PathCommand[] = [{ op: 'M', p: first }];
  for (let i = 1; i < points.length - 1; i++) {
    const c = points[i]!;
    const n = points[i + 1]!;
    cmds.push({ op: 'Q', c, p: { x: (c.x + n.x) / 2, y: (c.y + n.y) / 2 } });
  }
  cmds.push({ op: 'L', p: points[points.length - 1]! });
  return cmds;
}

const f2 = (n: number) => (Math.round(n * 100) / 100).toString();

export function toSvgPath(path: PathCommand[]): string {
  return path
    .map((c) => {
      switch (c.op) {
        case 'M':
        case 'L':
          return `${c.op}${f2(c.p.x)} ${f2(c.p.y)}`;
        case 'Q':
          return `Q${f2(c.c.x)} ${f2(c.c.y)} ${f2(c.p.x)} ${f2(c.p.y)}`;
        case 'C':
          return `C${f2(c.c1.x)} ${f2(c.c1.y)} ${f2(c.c2.x)} ${f2(c.c2.y)} ${f2(c.p.x)} ${f2(c.p.y)}`;
        case 'Z':
          return 'Z';
      }
    })
    .join('');
}

/** Converts quadratic segments to cubic ones (PDF only has cubic Béziers). */
export function toCubic(path: PathCommand[]): PathCommand[] {
  const out: PathCommand[] = [];
  let cur: Point = { x: 0, y: 0 };
  let start: Point = cur;
  for (const c of path) {
    if (c.op === 'Q') {
      out.push({
        op: 'C',
        c1: { x: cur.x + (2 / 3) * (c.c.x - cur.x), y: cur.y + (2 / 3) * (c.c.y - cur.y) },
        c2: { x: c.p.x + (2 / 3) * (c.c.x - c.p.x), y: c.p.y + (2 / 3) * (c.c.y - c.p.y) },
        p: c.p,
      });
      cur = c.p;
    } else {
      out.push(c);
      if (c.op === 'M') start = c.p;
      if (c.op === 'Z') cur = start;
      else cur = c.p;
    }
  }
  return out;
}
