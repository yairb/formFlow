import { memo } from 'react';
import { inkStrokesAbsolute } from '@/model/annotations';
import { MARK_SHAPES, smoothStrokePath, toSvgPath } from '@/model/paths';
import type { Annotation, InkAnnotation, MarkAnnotation } from '@/model/types';
import { TextRuns } from './TextRuns';

/** Visual rendering of one annotation at its rect (position is set by the caller). */
export const AnnotationContent = memo(function AnnotationContent({
  a,
  scale,
  hideText,
}: {
  a: Annotation;
  scale: number;
  /** Hide text while it is being edited (the editor shows its own copy). */
  hideText?: boolean;
}) {
  switch (a.type) {
    case 'text':
      return hideText ? null : <TextRuns a={a} scale={scale} color={a.color} />;
    case 'mark':
      return <MarkSvg a={a} />;
    case 'ink':
      return <InkSvg a={a} scale={scale} />;
    case 'signature':
      return (
        <img
          src={a.image.dataUrl}
          alt=""
          draggable={false}
          className="pointer-events-none absolute inset-0 size-full select-none"
        />
      );
    case 'highlight':
      return (
        <div
          className="pointer-events-none absolute inset-0 mix-blend-multiply"
          style={{ background: a.color, opacity: a.opacity }}
        />
      );
  }
});

function MarkSvg({ a }: { a: MarkAnnotation }) {
  const shape = MARK_SHAPES[a.mark];
  return (
    <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full overflow-visible">
      {shape.paths.map((p, i) => (
        <path
          key={i}
          d={toSvgPath(p)}
          fill={shape.fill ? a.color : 'none'}
          stroke={shape.fill ? 'none' : a.color}
          strokeWidth={shape.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

export function inkPathData(a: Pick<InkAnnotation, 'rect' | 'strokes'>): string[] {
  return inkStrokesAbsolute(a).map((s) =>
    toSvgPath(smoothStrokePath(s.map((p) => ({ x: p.x - a.rect.x, y: p.y - a.rect.y })))),
  );
}

function InkSvg({ a, scale }: { a: InkAnnotation; scale: number }) {
  const { width, height } = a.rect;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 size-full overflow-visible"
      style={{ width: width * scale, height: height * scale }}
    >
      {inkPathData(a).map((d, i) => (
        <path key={i} d={d} fill="none" stroke={a.color} strokeWidth={a.strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}
