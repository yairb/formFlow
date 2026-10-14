import { toVisualOrder } from './bidi';
import { splitFontRuns, type DocFontFamily, type FontKey, type FontLibrary } from './fonts';
import type { LaidOutLine } from './layout';
import type { TextAlign } from '@/model/types';

/**
 * A horizontally positioned piece of a line drawn with one font face.
 *
 * Both the editor and the exporter draw lines as a sequence of these runs, so
 * glyph positions are computed exactly once, by FormFlow, from the same font
 * data — not independently by the browser and by pdf-lib.
 */
export interface PositionedRun {
  /**
   * Text to hand to the renderer. For right-to-left script runs this is in
   * logical order (renderers reverse RTL runs themselves); otherwise visual order.
   */
  text: string;
  face: FontKey;
  rtl: boolean;
  /** Offset of the run's left edge from the line's left edge, in points. */
  x: number;
  width: number;
}

export function lineOffsetX(align: TextAlign, boxWidth: number, lineWidth: number): number {
  if (align === 'center') return (boxWidth - lineWidth) / 2;
  if (align === 'right') return boxWidth - lineWidth;
  return 0;
}

export function positionLineRuns(
  line: Pick<LaidOutLine, 'text' | 'direction'>,
  family: DocFontFamily,
  bold: boolean,
  size: number,
  lib: FontLibrary,
): PositionedRun[] {
  // Trailing whitespace never affects placement (it is excluded from the line width).
  const visual = toVisualOrder(line.text.replace(/\s+$/, ''), line.direction);
  const out: PositionedRun[] = [];
  let x = 0;
  for (const run of splitFontRuns(visual, family, bold)) {
    const width = lib.runWidth(run.text, run.face, size);
    const rtl = run.script === 'hebrew';
    out.push({ text: rtl ? [...run.text].reverse().join('') : run.text, face: run.face, rtl, x, width });
    x += width;
  }
  return out;
}
