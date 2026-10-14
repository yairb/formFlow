import { createCanvas } from '@napi-rs/canvas';
import { beforeAll, describe, expect, it } from 'vitest';
import { ExportError, exportPdf, exportRasterPdf } from '@/export/exportPdf';
import { addAnnotation, createTextAnnotation } from '@/model/annotations';
import { EMPTY_MODEL } from '@/model/types';
import { PdfLoadError } from '@/pdf/loader';
import type { FontLibrary } from '@/text/fonts';
import { makeEncryptedPdf } from '../helpers/encrypted';
import { loadTestFonts } from '../helpers/fonts';
import { extractText, inkBounds, open, renderPage } from '../helpers/pdf';

let fonts: FontLibrary;
beforeAll(async () => {
  fonts = await loadTestFonts();
});

describe('encrypted PDFs', () => {
  it('opens owner-restricted files without a password and reads their text', async () => {
    const pdf = await open(makeEncryptedPdf());
    expect(pdf.encrypted).toBe(true);
    const text = (await extractText(await pdf.doc.getPage(1))).map((t) => t.str).join(' ');
    expect(text).toContain('Name:');
  });

  it('asks for a password, rejects a wrong one, accepts the right one', async () => {
    const bytes = makeEncryptedPdf({ userPassword: 'formflow' });
    await expect(open(bytes)).rejects.toMatchObject({ code: 'needs-password' });
    await expect(open(bytes, 'nope')).rejects.toBeInstanceOf(PdfLoadError);
    await expect(open(bytes, 'nope')).rejects.toMatchObject({ code: 'wrong-password' });
    const pdf = await open(bytes, 'formflow');
    expect(pdf.pages).toHaveLength(1);
  });

  it('refuses in-place export and produces a valid flattened copy instead', async () => {
    const bytes = makeEncryptedPdf();
    const pdf = await open(bytes);
    const a = createTextAnnotation(0, { x: 130, y: 82 }, { fontSize: 14, fontFamily: 'sans', color: '#1d4ed8' }, { text: 'Dana Levi' });
    const model = addAnnotation(EMPTY_MODEL, a);
    const input = { bytes, pages: pdf.pages, model, fonts };

    await expect(exportPdf(input)).rejects.toSatisfy((e) => e instanceof ExportError && e.code === 'encrypted');

    const result = await exportRasterPdf(input, async (index) => {
      const page = await pdf.doc.getPage(index + 1);
      const vp = page.getViewport({ scale: 2 });
      const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport: vp }).promise;
      return { data: new Uint8Array(canvas.toBuffer('image/png')), format: 'png' };
    });

    const out = await open(result.bytes);
    expect(out.encrypted).toBe(false);
    expect(out.pages[0]).toMatchObject({ width: 612, height: 792 });
    const page = await out.doc.getPage(1);
    // The addition stays real text; the original page is now an image.
    const texts = (await extractText(page)).map((t) => t.str);
    expect(texts.join('')).toContain('Dana Levi');
    expect(texts.join('')).not.toContain('Name:');
    // And the original content is still visible underneath (the label left of the value).
    const r = await renderPage(page, 2);
    const label = inkBounds(r, (red, g, b) => red < 90 && g < 90 && b < 90, { x: 60, y: 80, width: 60, height: 20 });
    expect(label?.count ?? 0).toBeGreaterThan(20);
    const value = inkBounds(r, (red, _g, b) => b > 150 && red < 90, { x: 125, y: 70, width: 200, height: 30 });
    expect(value?.count ?? 0).toBeGreaterThan(20);
  });
});
