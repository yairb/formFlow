import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { configurePdfjs } from '@/pdf/pdfjs';

const require = createRequire(import.meta.url);
const pdfjsDir = dirname(require.resolve('pdfjs-dist/package.json'));

configurePdfjs({
  workerSrc: pathToFileURL(join(pdfjsDir, 'legacy/build/pdf.worker.mjs')).href,
  assets: {
    cMapUrl: join(pdfjsDir, 'cmaps') + '/',
    standardFontDataUrl: join(pdfjsDir, 'standard_fonts') + '/',
    wasmUrl: join(pdfjsDir, 'wasm') + '/',
  },
});
