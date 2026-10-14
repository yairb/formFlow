import type { FormField } from '@/model/types';
import type { OpenedPdf } from '@/pdf/loader';
import { extractPageContent } from './extract';
import { candidateToField, mergePage, pageIsRtl, readingOrder } from './merge';
import type { PageContent } from './primitives';
import { findSpaceBlanks, findUnderscoreBlanks, groupPhrases } from './textStage';
import { detectVisual } from './visualStage';

/**
 * Layered field detection, entirely local:
 *   1. native AcroForm widgets (read separately, passed in)
 *   2. text layout — underscore blanks and colon labels, multilingual incl. RTL
 *   3. vector graphics — rules, boxes, check squares, radio circles, table cells
 *   4. merge, de-duplicate, classify and order
 * Scanned (image-only) pages have no text or vectors to analyse; FormFlow has no
 * OCR, so they are reported rather than guessed at.
 */

export interface DetectionResult {
  /** Native fields followed by detected suggestions, in guided-filling order. */
  fields: FormField[];
  detectedCount: number;
  /** Pages that look like scans (mostly image, almost no text). */
  scannedPages: number[];
}

export interface DetectOptions {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export function analysePageContent(content: PageContent, native: FormField[]): FormField[] {
  const phrases = groupPhrases(content.texts);
  const { blanks, rest } = findUnderscoreBlanks(phrases);
  const spaces = findSpaceBlanks(rest, content);
  const visual = detectVisual(content, rest);
  const merged = mergePage({ pageIndex: content.pageIndex, native, blanks: [...blanks, ...spaces], visual: visual.candidates, officeZones: visual.officeZones, phrases: rest });
  const fields = [...native, ...merged.map(candidateToField)];
  return readingOrder(fields, pageIsRtl(phrases));
}

export function looksScanned(content: PageContent): boolean {
  const chars = content.texts.reduce((n, t) => n + t.str.trim().length, 0);
  return content.imageCoverage > 0.5 && chars < 20;
}

export async function detectFields(opened: OpenedPdf, nativeFields: FormField[], opts: DetectOptions = {}): Promise<DetectionResult> {
  const fields: FormField[] = [];
  const scannedPages: number[] = [];
  let detectedCount = 0;
  const total = opened.pages.length;
  for (const geom of opened.pages) {
    if (opts.signal?.aborted) throw new DOMException('Detection cancelled', 'AbortError');
    const native = nativeFields.filter((f) => f.pageIndex === geom.index);
    const page = await opened.doc.getPage(geom.index + 1);
    const content = await extractPageContent(page, geom);
    if (looksScanned(content)) {
      scannedPages.push(geom.index);
      fields.push(...native);
    } else {
      const pageFields = analysePageContent(content, native);
      detectedCount += pageFields.length - native.length;
      fields.push(...pageFields);
    }
    opts.onProgress?.(geom.index + 1, total);
    // Yield so the UI keeps painting on long documents.
    await new Promise((r) => setTimeout(r, 0));
  }
  return { fields, detectedCount, scannedPages };
}
