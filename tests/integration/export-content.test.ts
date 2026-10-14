import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  pushGraphicsState,
  concatTransformationMatrix,
  decodePDFRawStream,
  StandardFonts,
} from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import { beforeAll, describe, expect, it } from 'vitest';
import { exportPdf } from '@/export/exportPdf';
import {
  addAnnotation,
  createInkAnnotation,
  createSignatureAnnotation,
  createTextAnnotation,
  layoutTextAnnotation,
} from '@/model/annotations';
import { EMPTY_MODEL, type DocModel } from '@/model/types';
import type { FontLibrary } from '@/text/fonts';
import { loadTestFonts } from '../helpers/fonts';
import { extractText, inkBounds, makePdf, open, renderPage } from '../helpers/pdf';

let fonts: FontLibrary;
beforeAll(async () => {
  fonts = await loadTestFonts();
});

async function roundTrip(source: Uint8Array, build: (m: DocModel) => DocModel) {
  const before = await open(source);
  const model = build(EMPTY_MODEL);
  const result = await exportPdf({ bytes: source, pages: before.pages, model, fonts });
  const after = await open(result.bytes);
  const page = await after.doc.getPage(1);
  return { before, after, page, model, result };
}

const isDark = (r: number, g: number, b: number) => r < 110 && g < 110 && b < 110;

describe('text export', () => {
  it('exports Hebrew and mixed-direction text with correct logical content', async () => {
    const source = await makePdf([{}]);
    const t = createTextAnnotation(0, { x: 100, y: 200 }, { fontSize: 16, fontFamily: 'sans', color: '#000000' }, { text: 'שלום עולם' });
    const mixed = createTextAnnotation(0, { x: 100, y: 260 }, { fontSize: 16, fontFamily: 'sans', color: '#000000' }, { text: 'חתימה: John 2024' });
    const { page, result } = await roundTrip(source, (m) => addAnnotation(addAnnotation(m, t), mixed));
    expect(result.warnings).toEqual([]);
    const items = await extractText(page);
    const joined = items.filter((i) => i.y > 150).map((i) => i.str).join('');
    expect(joined.replace(/\s+/g, ' ')).toContain('שלום');
    expect(joined).toContain('עולם');
    expect(joined).toContain('John');
    expect(joined).toContain('2024');

    // Rendered glyphs occupy the measured box (i.e. the font subset draws real glyphs).
    const r = await renderPage(page, 3);
    const box = inkBounds(r, isDark, { x: t.rect.x - 4, y: t.rect.y - 4, width: t.rect.width + 8, height: t.rect.height + 8 })!;
    expect(box).not.toBeNull();
    expect(box.x).toBeGreaterThanOrEqual(t.rect.x - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(t.rect.x + t.rect.width + 1);
    expect(box.width).toBeGreaterThan(t.rect.width * 0.85);
  });

  it('reorders RTL words visually: first logical word is on the right', async () => {
    const source = await makePdf([{}]);
    // Two words of different width make the order observable in the raster.
    const t = createTextAnnotation(0, { x: 100, y: 200 }, { fontSize: 20, fontFamily: 'sans', color: '#000000' }, { text: 'א בבבבבבב' });
    const { page } = await roundTrip(source, (m) => addAnnotation(m, t));
    const r = await renderPage(page, 3);
    const lib = fonts;
    const wAlef = lib.measure('א', 'sans', false, 20);
    // Visual order is "בבבבבבב א": the single alef must be at the right end.
    const right = inkBounds(r, isDark, { x: t.rect.x + t.rect.width - wAlef - 1, y: t.rect.y, width: wAlef + 2, height: t.rect.height })!;
    const gap = inkBounds(r, isDark, { x: t.rect.x + t.rect.width - wAlef - lib.measure(' ', 'sans', false, 20) * 0.9, y: t.rect.y, width: 1, height: t.rect.height });
    expect(right.count).toBeGreaterThan(20);
    expect(gap).toBeNull();
  });

  it('keeps multi-line wrapping and alignment identical to the editor layout', async () => {
    const source = await makePdf([{}]);
    const base = createTextAnnotation(0, { x: 80, y: 300 }, { fontSize: 12, fontFamily: 'serif', color: '#000000' }, {
      text: 'The quick brown fox jumps over the lazy dog near the riverbank',
      autoWidth: false,
      align: 'right',
    });
    const t = { ...base, rect: { ...base.rect, width: 160 } };
    const layout = layoutTextAnnotation(t, fonts);
    expect(layout.lines.length).toBeGreaterThan(2);
    const { page } = await roundTrip(source, (m) => addAnnotation(m, t));
    const items = (await extractText(page)).filter((i) => i.y > 250);
    // Every line ends at the right edge of the box.
    const lines = new Map<number, { minX: number; text: string }>();
    for (const it of items) {
      const key = Math.round(it.y * 10);
      const l = lines.get(key) ?? { minX: Infinity, text: '' };
      l.minX = Math.min(l.minX, it.x);
      l.text += it.str;
      lines.set(key, l);
    }
    expect(lines.size).toBe(layout.lines.length);
    const sorted = [...lines.entries()].sort((a, b) => a[0] - b[0]);
    sorted.forEach(([, l], i) => {
      const line = layout.lines[i]!;
      expect(l.text.trim()).toBe(line.text.trim());
      expect(l.minX).toBeCloseTo(t.rect.x + t.rect.width - line.width, 1);
    });
  });

  it('is unaffected by pages whose content leaves the graphics state transformed', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('Original', { x: 50, y: 700, size: 12, font });
    // Unbalanced: scale 0.5 without Q — later content would be shrunk if not isolated.
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(0.5, 0, 0, 0.5, 0, 0));
    const source = await doc.save();
    const t = createTextAnnotation(0, { x: 300, y: 400 }, { fontSize: 20, fontFamily: 'sans', color: '#000000' }, { text: 'Placed' });
    const { page: out } = await roundTrip(source, (m) => addAnnotation(m, t));
    const placed = (await extractText(out)).find((i) => i.str === 'Placed')!;
    expect(placed.fontSize).toBeCloseTo(20, 3);
    expect(placed.x).toBeCloseTo(300, 2);
  });

  it('warns about characters the bundled fonts cannot draw', async () => {
    const source = await makePdf([{}]);
    const t = createTextAnnotation(0, { x: 100, y: 200 }, { fontSize: 12, fontFamily: 'sans', color: '#000000' }, { text: 'Hi 你好' });
    const { result } = await roundTrip(source, (m) => addAnnotation(m, t));
    expect(result.warnings).toEqual([{ kind: 'missing-glyphs', characters: ['你', '好'] }]);
  });

  it('embeds fonts whole, since fontkit subsets lose most glyphs in Apple PDF viewers', async () => {
    const source = await makePdf([{}]);
    const t = createTextAnnotation(0, { x: 100, y: 200 }, { fontSize: 12, fontFamily: 'sans', color: '#000000' }, { text: 'Hello World' });
    const { result } = await roundTrip(source, (m) => addAnnotation(m, t));
    const out = await PDFDocument.load(result.bytes);
    const files = out.context
      .enumerateIndirectObjects()
      .map(([, o]) => (o instanceof PDFDict ? o.lookup(PDFName.of('FontFile2')) : undefined))
      .filter((o): o is PDFRawStream => o instanceof PDFRawStream);
    expect(files).toHaveLength(1);
    expect(decodePDFRawStream(files[0]!).decode()).toEqual(fonts.getBytes('sans-regular'));
  });
});

describe('graphics export', () => {
  it('embeds signature images with their aspect ratio inside the placed rect', async () => {
    const c = createCanvas(300, 100);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(0, 0, 300, 100);
    const dataUrl = `data:image/png;base64,${c.toBuffer('image/png').toString('base64')}`;
    const sig = createSignatureAnnotation(0, { x: 100, y: 500, width: 150, height: 50 }, { dataUrl, pixelWidth: 300, pixelHeight: 100 });
    const source = await makePdf([{ rotate: 90 }]);
    const { page } = await roundTrip(source, (m) => addAnnotation(m, sig));
    const r = await renderPage(page, 2);
    const blue = inkBounds(r, (R, G, B) => B > 200 && R < 60 && G < 60)!;
    expect(blue.x).toBeCloseTo(100, 0);
    expect(blue.y).toBeCloseTo(500, 0);
    expect(blue.width).toBeCloseTo(150, 0);
    expect(blue.height).toBeCloseTo(50, 0);
  });

  it('draws ink strokes along the drawn path', async () => {
    const stroke = Array.from({ length: 30 }, (_, i) => ({ x: 100 + i * 5, y: 600 + Math.sin(i / 4) * 10 }));
    const ink = createInkAnnotation(0, stroke, '#ff0000', 2);
    const source = await makePdf([{ rotate: 270 }]);
    const { page } = await roundTrip(source, (m) => addAnnotation(m, ink));
    const r = await renderPage(page, 2);
    const red = inkBounds(r, (R, G, B) => R > 180 && G < 80 && B < 80)!;
    expect(red.x).toBeGreaterThanOrEqual(ink.rect.x - 0.5);
    expect(red.x + red.width).toBeLessThanOrEqual(ink.rect.x + ink.rect.width + 0.5);
    expect(red.y).toBeGreaterThanOrEqual(ink.rect.y - 0.5);
    expect(red.y + red.height).toBeLessThanOrEqual(ink.rect.y + ink.rect.height + 0.5);
    expect(red.width).toBeGreaterThan(140);
  });
});

describe('source integrity', () => {
  it('never modifies the input bytes and keeps all pages', async () => {
    const source = await makePdf([{}, { rotate: 90 }, {}]);
    const copy = source.slice();
    const before = await open(source);
    const t = createTextAnnotation(1, { x: 50, y: 50 }, { fontSize: 12, fontFamily: 'sans', color: '#000' }, { text: 'p2' });
    const result = await exportPdf({ bytes: source, pages: before.pages, model: addAnnotation(EMPTY_MODEL, t), fonts });
    expect(source).toEqual(copy);
    const after = await open(result.bytes);
    expect(after.doc.numPages).toBe(3);
    const texts = await Promise.all([1, 2, 3].map(async (n) => (await extractText(await after.doc.getPage(n))).map((i) => i.str).join(' ')));
    expect(texts[0]).toBe('Page 1');
    expect(texts[1]).toContain('p2');
    expect(texts[2]).toBe('Page 3');
    // The re-saved file is a plain PDF readable by pdf-lib as well.
    const reparsed = await PDFDocument.load(result.bytes);
    expect(reparsed.getPageCount()).toBe(3);
  });
});
