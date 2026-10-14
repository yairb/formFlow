import workerSrc from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { configurePdfjs } from './pdfjs';

/** Points pdf.js at its bundled worker and the locally copied data files (public/pdfjs). */
export function setupPdfjsForBrowser(): void {
  const base = `${import.meta.env.BASE_URL}pdfjs/`;
  configurePdfjs({
    workerSrc,
    assets: {
      cMapUrl: `${base}cmaps/`,
      standardFontDataUrl: `${base}standard_fonts/`,
      wasmUrl: `${base}wasm/`,
      iccUrl: `${base}iccs/`,
    },
  });
}
