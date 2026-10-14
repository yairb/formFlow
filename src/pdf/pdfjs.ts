/**
 * Single import point for pdf.js. The legacy build is used everywhere (app, tests,
 * scripts) because it supports older WebKit versions shipped with macOS and runs in
 * Node for integration tests — one code path, one set of behaviours.
 */
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

export { pdfjs };
export type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/types/src/display/api';

export interface PdfjsAssetUrls {
  cMapUrl?: string;
  standardFontDataUrl?: string;
  wasmUrl?: string;
  iccUrl?: string;
}

let assets: PdfjsAssetUrls = {};

export function configurePdfjs(opts: { workerSrc?: string; assets?: PdfjsAssetUrls }): void {
  if (opts.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = opts.workerSrc;
  if (opts.assets) assets = { ...opts.assets };
}

export function pdfjsAssetUrls(): PdfjsAssetUrls {
  return assets;
}
