import { createPageGeometry, type PageGeometry, type PdfBox } from './geometry';
import { pdfjs, pdfjsAssetUrls, type PDFDocumentProxy } from './pdfjs';

export const MAX_PDF_BYTES = 512 * 1024 * 1024;

export type PdfLoadErrorCode =
  | 'empty'
  | 'not-pdf'
  | 'too-large'
  | 'needs-password'
  | 'wrong-password'
  | 'corrupt';

const MESSAGES: Record<PdfLoadErrorCode, string> = {
  empty: 'The file is empty.',
  'not-pdf': 'This file is not a PDF document.',
  'too-large': 'This PDF is larger than 512 MB and cannot be opened.',
  'needs-password': 'This PDF is protected with a password.',
  'wrong-password': 'The password is incorrect.',
  corrupt: 'This PDF is damaged and could not be read.',
};

export class PdfLoadError extends Error {
  readonly code: PdfLoadErrorCode;
  constructor(code: PdfLoadErrorCode, detail?: string) {
    super(MESSAGES[code]);
    this.name = 'PdfLoadError';
    this.code = code;
    if (detail) this.cause = detail;
  }
}

export interface OpenedPdf {
  doc: PDFDocumentProxy;
  pages: PageGeometry[];
  /** Original file bytes (never modified; pdf.js gets its own copy). */
  bytes: Uint8Array;
  /** SHA-256 of the bytes, hex — identifies the document for session recovery. */
  hash: string;
  /** The file uses PDF encryption (possibly with an empty user password). */
  encrypted: boolean;
  /** Password used to open it, kept in memory only for the raster export fallback. */
  password?: string;
  hasAcroForm: boolean;
  /** Dynamic XFA forms cannot be filled; FormFlow shows the static fallback. */
  isXfa: boolean;
  title: string | null;
}

/** Checks for a PDF header within the first 1 KB, as PDF readers do. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  return head.includes('%PDF-');
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface PdfjsError {
  name?: string;
  code?: number;
  message?: string;
}

export async function openPdf(bytes: Uint8Array, opts: { password?: string } = {}): Promise<OpenedPdf> {
  if (bytes.byteLength === 0) throw new PdfLoadError('empty');
  if (bytes.byteLength > MAX_PDF_BYTES) throw new PdfLoadError('too-large');
  if (!looksLikePdf(bytes)) throw new PdfLoadError('not-pdf');

  const task = pdfjs.getDocument({
    // pdf.js transfers the buffer to its worker; keep the caller's copy intact.
    data: bytes.slice(),
    password: opts.password,
    enableXfa: false,
    useSystemFonts: false,
    disableAutoFetch: true,
    ...pdfjsAssetUrls(),
  });

  let doc: PDFDocumentProxy;
  try {
    doc = await task.promise;
  } catch (e) {
    const err = e as PdfjsError;
    if (err?.name === 'PasswordException') {
      throw new PdfLoadError(
        err.code === pdfjs.PasswordResponses.INCORRECT_PASSWORD ? 'wrong-password' : 'needs-password',
      );
    }
    throw new PdfLoadError('corrupt', err?.message);
  }

  try {
    const [pages, meta, hash] = await Promise.all([
      loadPageGeometries(doc),
      doc.getMetadata().catch(() => null),
      sha256Hex(bytes),
    ]);
    const info = (meta?.info ?? {}) as Record<string, unknown>;
    const title = typeof info.Title === 'string' && info.Title.trim() ? info.Title.trim() : null;
    return {
      doc,
      pages,
      bytes,
      hash,
      encrypted: typeof info.EncryptFilterName === 'string' || opts.password !== undefined,
      password: opts.password,
      hasAcroForm: info.IsAcroFormPresent === true,
      isXfa: info.IsXFAPresent === true,
      title,
    };
  } catch (e) {
    await doc.destroy();
    throw new PdfLoadError('corrupt', (e as PdfjsError)?.message);
  }
}

async function loadPageGeometries(doc: PDFDocumentProxy): Promise<PageGeometry[]> {
  const out: PageGeometry[] = new Array<PageGeometry>(doc.numPages);
  const BATCH = 16;
  for (let start = 0; start < doc.numPages; start += BATCH) {
    const end = Math.min(doc.numPages, start + BATCH);
    await Promise.all(
      Array.from({ length: end - start }, async (_, k) => {
        const i = start + k;
        const page = await doc.getPage(i + 1);
        out[i] = createPageGeometry(i, page.view as unknown as PdfBox, page.rotate);
      }),
    );
  }
  return out;
}
