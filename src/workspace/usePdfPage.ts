import { useEffect, useState } from 'react';
import type { PDFDocumentProxy, PDFPageProxy } from '@/pdf/pdfjs';

const cache = new WeakMap<PDFDocumentProxy, Map<number, Promise<PDFPageProxy>>>();

export function getPdfPage(doc: PDFDocumentProxy, index: number): Promise<PDFPageProxy> {
  let pages = cache.get(doc);
  if (!pages) cache.set(doc, (pages = new Map()));
  let p = pages.get(index);
  if (!p) {
    p = doc.getPage(index + 1);
    pages.set(index, p);
  }
  return p;
}

export function usePdfPage(doc: PDFDocumentProxy, index: number): PDFPageProxy | null {
  const [page, setPage] = useState<{ doc: PDFDocumentProxy; index: number; page: PDFPageProxy } | null>(null);
  useEffect(() => {
    let live = true;
    getPdfPage(doc, index).then(
      (p) => live && setPage({ doc, index, page: p }),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [doc, index]);
  return page && page.doc === doc && page.index === index ? page.page : null;
}
