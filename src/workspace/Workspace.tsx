import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PageGeometry, Point, Size } from '@/pdf/geometry';
import type { PDFDocumentProxy } from '@/pdf/pdfjs';
import { ui, useUi, MAX_SCALE, MIN_SCALE } from '@/state/ui';
import { anchoredScroll, fitScale, layoutPages, mostVisiblePage, scrollToReveal, visibleRange, type WorkspaceLayout } from './layout';
import { PageCanvas } from './PageCanvas';
import { PageOverlay } from './PageOverlay';

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/**
 * The scrolling document view. Only pages near the viewport mount a canvas and
 * overlay; the rest are sized placeholders so scroll geometry stays exact.
 */
export function Workspace({ doc, pages }: { doc: PDFDocumentProxy; pages: PageGeometry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  const scale = useUi((s) => s.scale);
  const zoomMode = useUi((s) => s.zoomMode);
  const scrollRequest = useUi((s) => s.scrollRequest);

  // Track viewport size.
  useLayoutEffect(() => {
    const el = scrollRef.current!;
    const update = () => setViewport((v) => (v.width === el.clientWidth && v.height === el.clientHeight ? v : { width: el.clientWidth, height: el.clientHeight }));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit modes recompute the scale whenever the viewport changes.
  useLayoutEffect(() => {
    if (zoomMode === 'custom' || viewport.width === 0) return;
    const s = fitScale(pages, zoomMode, viewport, ui().currentPage);
    if (Math.abs(s - ui().scale) > 0.0005) ui().setZoom(zoomMode, s);
  }, [zoomMode, viewport, pages]);

  const layout = useMemo(() => layoutPages(pages, scale, viewport.width), [pages, scale, viewport.width]);

  // Keep the point under the zoom anchor fixed when the scale changes.
  const prevLayout = useRef<WorkspaceLayout | null>(null);
  const zoomAnchor = useRef<Point | null>(null);
  useLayoutEffect(() => {
    const el = scrollRef.current!;
    const before = prevLayout.current;
    prevLayout.current = layout;
    if (!before || before.scale === layout.scale || before.slots.length !== layout.slots.length) return;
    const explicit = zoomAnchor.current;
    zoomAnchor.current = null;
    // At the very top (e.g. the initial fit), stay at the top instead of drifting.
    if (!explicit && el.scrollTop === 0) return;
    const anchor = explicit ?? { x: el.clientWidth / 2, y: el.clientHeight / 2 };
    const next = anchoredScroll(before, layout, { x: el.scrollLeft, y: el.scrollTop }, anchor);
    el.scrollLeft = next.x;
    el.scrollTop = next.y;
    setScrollTop(el.scrollTop);
  }, [layout]);

  // Programmatic scrolling (page jumps, guided field focus).
  useEffect(() => {
    if (!scrollRequest) return;
    const el = scrollRef.current!;
    const target = scrollToReveal(layout, scrollRequest.pageIndex, scrollRequest.rect, viewport, { x: el.scrollLeft, y: el.scrollTop });
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ left: target.x, top: target.y, behavior: scrollRequest.smooth && !reduce ? 'smooth' : 'auto' });
    // Only the nonce matters; layout/viewport are read at request time.
  }, [scrollRequest?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll tracking: virtualization window + current page indicator.
  const raf = useRef(0);
  const onScroll = useCallback(() => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const el = scrollRef.current;
      if (el) setScrollTop(el.scrollTop);
    });
  }, []);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  useEffect(() => {
    if (viewport.height === 0) return;
    ui().setCurrentPage(mostVisiblePage(layout.slots, scrollTop, viewport.height));
  }, [layout, scrollTop, viewport.height]);

  // Pinch / ctrl-wheel zoom anchored at the pointer.
  useEffect(() => {
    const el = scrollRef.current!;
    const zoomAt = (factor: number, clientX: number, clientY: number) => {
      const r = el.getBoundingClientRect();
      zoomAnchor.current = { x: clientX - r.left, y: clientY - r.top };
      ui().setZoom('custom', clampScale(ui().scale * factor));
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(Math.exp(-Math.max(-60, Math.min(60, delta)) * 0.01), e.clientX, e.clientY);
    };
    // Safari / WKWebView trackpad pinch.
    let gestureScale = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureScale = 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      zoomAt(g.scale / gestureScale, g.clientX, g.clientY);
      gestureScale = g.scale;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
    };
  }, []);

  const [first, last] = visibleRange(layout.slots, scrollTop, viewport.height, Math.max(600, viewport.height));

  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget) return;
    ui().setEditing(null);
    ui().select([]);
  };

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="ff-workspace relative h-full min-h-0 overflow-auto overscroll-contain bg-canvas outline-none"
      tabIndex={-1}
      aria-label="Document pages"
      data-testid="workspace"
    >
      <div className="relative" style={{ width: layout.width, height: layout.height }} onPointerDown={onBackgroundPointerDown}>
        {viewport.width > 0 &&
          layout.slots.map((slot) => {
            const geom = pages[slot.index]!;
            const mounted = slot.index >= first && slot.index <= last;
            return (
              <PageView
                key={slot.index}
                doc={doc}
                geom={geom}
                scale={scale}
                top={slot.top}
                left={slot.left}
                width={slot.width}
                height={slot.height}
                mounted={mounted}
                count={pages.length}
              />
            );
          })}
      </div>
    </div>
  );
}

const PageView = memo(function PageView({
  doc,
  geom,
  scale,
  top,
  left,
  width,
  height,
  mounted,
  count,
}: {
  doc: PDFDocumentProxy;
  geom: PageGeometry;
  scale: number;
  top: number;
  left: number;
  width: number;
  height: number;
  mounted: boolean;
  count: number;
}) {
  return (
    <section
      aria-label={`Page ${geom.index + 1} of ${count}`}
      data-page-index={geom.index}
      className="ff-page absolute bg-white"
      style={{ top, left, width, height }}
    >
      {mounted && (
        <>
          <PageCanvas doc={doc} index={geom.index} size={geom} scale={scale} />
          <PageOverlay geom={geom} scale={scale} />
        </>
      )}
    </section>
  );
});
