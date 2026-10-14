import { isCheckable, isManagedNative } from '@/model/native';
import type { FormField } from '@/model/types';
import { pdfjs, type PDFDocumentProxy, type PDFPageProxy } from './pdfjs';

/**
 * Page rendering rules shared by the workspace and thumbnails.
 *
 * Pages are rendered with `AnnotationMode.ENABLE_STORAGE`: annotations, including
 * form widgets, are painted onto the canvas from pdf.js's annotation storage — no
 * separate HTML form layer. Every native field FormFlow manages is blanked in that
 * storage, because FormFlow draws those values itself (as bound annotations); this
 * keeps exactly one visible copy of each value. Read-only and signature fields keep
 * their original appearance.
 */
export const PAGE_ANNOTATION_MODE = pdfjs.AnnotationMode.ENABLE_STORAGE;

export function blankManagedNativeFields(doc: PDFDocumentProxy, fields: Iterable<FormField>): void {
  const storage = doc.annotationStorage;
  for (const f of fields) {
    if (!isManagedNative(f)) continue;
    storage.setValue(f.native.annotationId, { value: isCheckable(f) ? false : f.native.fieldType === 'Ch' ? [] : '' });
  }
}

export interface RenderTarget {
  canvas: HTMLCanvasElement;
  /** CSS px per PDF point. */
  scale: number;
  /** Backing-store pixels per CSS px (devicePixelRatio, possibly capped). */
  outputScale: number;
}

/** Starts rendering a page into a canvas sized for `scale * outputScale`; returns the render task. */
export function renderPageInto(page: PDFPageProxy, target: RenderTarget) {
  const viewport = page.getViewport({ scale: target.scale * target.outputScale });
  const { canvas } = target;
  const w = Math.max(1, Math.floor(viewport.width));
  const h = Math.max(1, Math.floor(viewport.height));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  return page.render({
    canvas,
    viewport,
    annotationMode: PAGE_ANNOTATION_MODE,
    background: '#ffffff',
  });
}
