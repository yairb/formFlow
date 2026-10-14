import { memo, useEffect, useRef, useState } from 'react';
import { canvasPixelSize, type Size } from '@/pdf/geometry';
import type { PDFDocumentProxy } from '@/pdf/pdfjs';
import { renderPageInto } from '@/pdf/render';
import { usePdfPage } from './usePdfPage';

const RERENDER_DELAY_MS = 140;
/** Keeps memory bounded on huge zooms: at most ~16.7 MP per page canvas. */
const MAX_CANVAS_PIXELS = 16_777_216;

/**
 * The rendered PDF page. While zooming, the previous bitmap is stretched to the new
 * size (cheap and immediate) and a sharp render replaces it once zooming settles.
 */
export const PageCanvas = memo(function PageCanvas({
  doc,
  index,
  size,
  scale,
  onRendered,
}: {
  doc: PDFDocumentProxy;
  index: number;
  size: Size;
  scale: number;
  onRendered?: () => void;
}) {
  const page = usePdfPage(doc, index);
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'pending' | 'ready' | 'error'>('pending');

  useEffect(() => {
    const host = hostRef.current;
    if (!page || !host) return;
    let task: ReturnType<typeof renderPageInto> | null = null;
    let cancelled = false;
    const hasBitmap = host.querySelector('canvas') !== null;
    const timer = setTimeout(
      () => {
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        const { outputScale } = canvasPixelSize(size, scale, dpr, MAX_CANVAS_PIXELS);
        const canvas = document.createElement('canvas');
        canvas.className = 'absolute inset-0 size-full';
        canvas.setAttribute('aria-hidden', 'true');
        task = renderPageInto(page, { canvas, scale, outputScale });
        task.promise.then(
          () => {
            if (cancelled) return;
            // Swap in the sharp bitmap and release the old one's memory.
            for (const old of host.querySelectorAll('canvas')) {
              old.width = old.height = 0;
              old.remove();
            }
            host.appendChild(canvas);
            setState('ready');
            onRendered?.();
          },
          (err: unknown) => {
            canvas.width = canvas.height = 0;
            if (cancelled || (err instanceof Error && err.name === 'RenderingCancelledException')) return;
            setState('error');
          },
        );
      },
      hasBitmap ? RERENDER_DELAY_MS : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
      task?.cancel();
    };
  }, [page, scale, size, onRendered]);

  // Release canvases when the page leaves the virtualized window.
  useEffect(() => {
    const host = hostRef.current;
    return () => {
      host?.querySelectorAll('canvas').forEach((c) => {
        c.width = c.height = 0;
      });
    };
  }, []);

  return (
    <div ref={hostRef} className="absolute inset-0 overflow-hidden">
      {state === 'pending' && <div className="ff-skeleton absolute inset-0 opacity-60" />}
      {state === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-fg-tertiary">
          This page could not be displayed.
        </div>
      )}
    </div>
  );
});
