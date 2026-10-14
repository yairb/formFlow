import { createCanvas } from '@napi-rs/canvas';
import { degrees, PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { openPdf, type OpenedPdf } from '@/pdf/loader';
import type { PDFPageProxy } from '@/pdf/pdfjs';

export interface PageSpec {
  size?: [number, number];
  rotate?: 0 | 90 | 180 | 270;
  /** CropBox [x, y, width, height] in user space. */
  crop?: [number, number, number, number];
  /** MediaBox origin offset (some generators use non-zero origins). */
  mediaOrigin?: [number, number];
}

/** Builds a test PDF with a label on each page (so pages are visually distinct). */
export async function makePdf(specs: PageSpec[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  specs.forEach((s, i) => {
    const [w, h] = s.size ?? [612, 792];
    const page = doc.addPage([w, h]);
    if (s.mediaOrigin) page.setMediaBox(s.mediaOrigin[0], s.mediaOrigin[1], w, h);
    const ox = s.mediaOrigin?.[0] ?? 0;
    const oy = s.mediaOrigin?.[1] ?? 0;
    page.drawText(`Page ${i + 1}`, { x: ox + 40, y: oy + h - 60, size: 18, font, color: rgb(0.2, 0.2, 0.2) });
    if (s.crop) page.setCropBox(...s.crop);
    if (s.rotate) page.setRotation(degrees(s.rotate));
  });
  return doc.save();
}

export function open(bytes: Uint8Array, password?: string): Promise<OpenedPdf> {
  return openPdf(bytes, { password });
}

export interface ExtractedText {
  str: string;
  /** Baseline origin in display space (points, top-left origin). */
  x: number;
  y: number;
  /** Direction of the text baseline in display space, degrees. */
  angle: number;
  fontSize: number;
}

/** Extracts text items and converts their origins into FormFlow display space. */
export async function extractText(page: PDFPageProxy): Promise<ExtractedText[]> {
  const vp = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const out: ExtractedText[] = [];
  for (const item of content.items) {
    if (!('str' in item) || !item.str) continue;
    const [a, b, , , e, f] = item.transform as number[];
    const [x, y] = vp.convertToViewportPoint(e!, f!);
    const [x2, y2] = vp.convertToViewportPoint(e! + a!, f! + b!);
    out.push({
      str: item.str,
      x: x!,
      y: y!,
      angle: Math.round((Math.atan2(y2! - y!, x2! - x!) * 180) / Math.PI),
      fontSize: Math.hypot(a!, b!),
    });
  }
  return out;
}

/** Renders a page at `scale` CSS px per point into RGBA pixels (display orientation). */
export async function renderPage(
  page: PDFPageProxy,
  scale = 2,
  annotationMode?: number,
): Promise<{ width: number; height: number; data: Uint8ClampedArray; scale: number }> {
  const vp = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport: vp, annotationMode }).promise;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: img.data, scale };
}

/** Bounding box (display points) of pixels matching `pred`, or null. */
export function inkBounds(
  r: { width: number; height: number; data: Uint8ClampedArray; scale: number },
  pred: (red: number, green: number, blue: number) => boolean,
  region?: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number; count: number } | null {
  const x0 = region ? Math.max(0, Math.floor(region.x * r.scale)) : 0;
  const y0 = region ? Math.max(0, Math.floor(region.y * r.scale)) : 0;
  const x1 = region ? Math.min(r.width, Math.ceil((region.x + region.width) * r.scale)) : r.width;
  const y1 = region ? Math.min(r.height, Math.ceil((region.y + region.height) * r.scale)) : r.height;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * r.width + x) * 4;
      if (pred(r.data[i]!, r.data[i + 1]!, r.data[i + 2]!)) {
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (count === 0) return null;
  const s = r.scale;
  return { x: minX / s, y: minY / s, width: (maxX - minX + 1) / s, height: (maxY - minY + 1) / s, count };
}
