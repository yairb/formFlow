import { beforeAll, describe, expect, it } from 'vitest';
import { exportPdf } from '@/export/exportPdf';
import { addAnnotation, createHighlightAnnotation, createMarkAnnotation, createTextAnnotation } from '@/model/annotations';
import { EMPTY_MODEL, type DocModel } from '@/model/types';
import type { FontLibrary } from '@/text/fonts';
import { baselineOffset } from '@/text/metrics';
import { loadTestFonts } from '../helpers/fonts';
import { extractText, inkBounds, makePdf, open, renderPage, type PageSpec } from '../helpers/pdf';

let fonts: FontLibrary;
beforeAll(async () => {
  fonts = await loadTestFonts();
});

const SPECS: [string, PageSpec][] = [
  ['upright', {}],
  ['rotated 90', { rotate: 90 }],
  ['rotated 180', { rotate: 180 }],
  ['rotated 270', { rotate: 270 }],
  ['cropped + rotated 90', { crop: [40, 60, 420, 560], rotate: 90 }],
  ['offset media box', { mediaOrigin: [-72, 144] }],
];

const TEXT_AT = { x: 120, y: 150 };
const SIZE = 14;

describe('exported content lands where it was placed (display space)', () => {
  for (const [name, spec] of SPECS) {
    it(name, async () => {
      const source = await makePdf([spec]);
      const before = await open(source);
      const geom = before.pages[0]!;
      let model: DocModel = EMPTY_MODEL;
      const text = createTextAnnotation(0, TEXT_AT, { fontSize: SIZE, fontFamily: 'sans', color: '#d01010' }, { text: 'Hello FormFlow' });
      model = addAnnotation(model, text);
      const mark = createMarkAnnotation(0, { x: 200, y: 300 }, 'cross', 20, '#1010d0');
      model = addAnnotation(model, mark);
      const hl = createHighlightAnnotation(0, { x: 60, y: 380, width: 150, height: 30 }, '#00c000');
      model = addAnnotation(model, { ...hl, opacity: 1 });

      const { bytes, warnings } = await exportPdf({ bytes: source, pages: before.pages, model, fonts });
      expect(warnings).toEqual([]);
      const after = await open(bytes);
      const page = await after.doc.getPage(1);

      // Page geometry preserved.
      expect(after.pages[0]!.width).toBeCloseTo(geom.width, 6);
      expect(after.pages[0]!.height).toBeCloseTo(geom.height, 6);
      expect(after.pages[0]!.rotation).toBe(geom.rotation);

      // Text: content, upright, baseline exactly where the editor draws it.
      const items = await extractText(page);
      // Original content survives (the label lies outside the crop box in the cropped case).
      if (!spec.crop) expect(items.map((i) => i.str).join('|')).toContain('Page 1');
      const hello = items.find((i) => i.str.includes('Hello'));
      expect(hello).toBeDefined();
      expect(items.filter((i) => i.str !== 'Page 1').map((i) => i.str).join('')).toBe('Hello FormFlow');
      expect(hello!.angle).toBe(0);
      expect(hello!.fontSize).toBeCloseTo(SIZE, 3);
      expect(hello!.x).toBeCloseTo(text.rect.x, 2);
      expect(hello!.y).toBeCloseTo(text.rect.y + baselineOffset(SIZE), 2);

      // Raster check: pixels of each addition fall inside its rect.
      const r = await renderPage(page, 2);
      const red = inkBounds(r, (R, G, B) => R > 150 && G < 90 && B < 90);
      expect(red).not.toBeNull();
      expect(red!.x).toBeGreaterThanOrEqual(text.rect.x - 0.5);
      expect(red!.y).toBeGreaterThanOrEqual(text.rect.y - 0.5);
      expect(red!.x + red!.width).toBeLessThanOrEqual(text.rect.x + text.rect.width + 0.5);
      expect(red!.y + red!.height).toBeLessThanOrEqual(text.rect.y + text.rect.height + 0.5);

      const blue = inkBounds(r, (R, G, B) => B > 150 && R < 90 && G < 90)!;
      expect(blue.x).toBeGreaterThanOrEqual(mark.rect.x - 0.5);
      expect(blue.x + blue.width).toBeLessThanOrEqual(mark.rect.x + mark.rect.width + 0.5);
      expect(blue.y).toBeGreaterThanOrEqual(mark.rect.y - 0.5);
      expect(blue.y + blue.height).toBeLessThanOrEqual(mark.rect.y + mark.rect.height + 0.5);
      // The cross is roughly centered in its box.
      expect(blue.x + blue.width / 2).toBeCloseTo(200, 0);
      expect(blue.y + blue.height / 2).toBeCloseTo(300, 0);

      const green = inkBounds(r, (R, G, B) => G > 150 && R < 60 && B < 60)!;
      expect(green.x).toBeCloseTo(60, 0);
      expect(green.y).toBeCloseTo(380, 0);
      expect(green.width).toBeCloseTo(150, 0);
      expect(green.height).toBeCloseTo(30, 0);

      await before.doc.destroy();
      await after.doc.destroy();
    });
  }
});
