import { memo, useMemo } from 'react';
import { layoutTextAnnotation } from '@/model/annotations';
import type { TextAnnotation } from '@/model/types';
import { familyCss, familySupportsBold, getSharedFontLibrary } from '@/text/fonts';
import { lineOffsetX, positionLineRuns, type PositionedRun } from '@/text/runs';

interface Line {
  top: number;
  left: number;
  runs: PositionedRun[];
}

type TextShape = Pick<TextAnnotation, 'text' | 'fontSize' | 'fontFamily' | 'bold' | 'autoWidth' | 'align' | 'rect'>;

/** Line and run positions in display points — identical to what the exporter draws. */
export function useTextLines(a: TextShape): { lines: Line[]; lineHeight: number } {
  const { text, fontSize, fontFamily, bold, autoWidth, align } = a;
  const width = a.rect.width;
  return useMemo(() => {
    const lib = getSharedFontLibrary();
    const layout = layoutTextAnnotation({ text, fontSize, fontFamily, bold, autoWidth, rect: { x: 0, y: 0, width, height: 0 } }, lib);
    const lines = layout.lines.map((line, i) => ({
      top: i * layout.lineHeight,
      left: lineOffsetX(align, width, line.width),
      runs: positionLineRuns(line, fontFamily, bold, fontSize, lib),
    }));
    return { lines, lineHeight: layout.lineHeight };
  }, [text, fontSize, fontFamily, bold, autoWidth, align, width]);
}

/**
 * Renders document text as absolutely positioned runs. The browser only shapes
 * each run; FormFlow decides where every run starts, so the on-screen result and
 * the exported PDF use the same line breaks and the same horizontal positions.
 */
export const TextRuns = memo(function TextRuns({
  a,
  scale,
  color,
}: {
  a: TextShape;
  scale: number;
  color: string;
}) {
  const { lines, lineHeight } = useTextLines(a);
  const fontSize = a.fontSize * scale;
  const weight = a.bold && familySupportsBold(a.fontFamily) ? 700 : 400;
  return (
    <div
      className="ff-doc-text pointer-events-none absolute inset-0"
      style={{ fontFamily: familyCss(a.fontFamily), fontSize, fontWeight: weight, lineHeight: `${lineHeight * scale}px`, color }}
      aria-hidden
    >
      {lines.map((line, li) =>
        line.runs.map((run, ri) => (
          <span
            key={`${li}:${ri}`}
            className="absolute whitespace-pre"
            style={{
              left: (line.left + run.x) * scale,
              top: line.top * scale,
              width: run.width * scale,
              height: lineHeight * scale,
              direction: run.rtl ? 'rtl' : 'ltr',
              unicodeBidi: 'bidi-override',
            }}
          >
            {run.text}
          </span>
        )),
      )}
    </div>
  );
});
