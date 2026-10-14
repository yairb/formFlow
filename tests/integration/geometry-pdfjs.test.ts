import { describe, expect, it } from 'vitest';
import { displayToUser, userToDisplay } from '@/pdf/geometry';
import { makePdf, open, type PageSpec } from '../helpers/pdf';

const CASES: [string, PageSpec][] = [
  ['letter, no rotation', {}],
  ['rotated 90', { rotate: 90 }],
  ['rotated 180', { rotate: 180 }],
  ['rotated 270', { rotate: 270 }],
  ['cropped', { crop: [50, 80, 400, 500] }],
  ['cropped + rotated 90', { crop: [50, 80, 400, 500], rotate: 90 }],
  ['offset media box + rotated 270', { mediaOrigin: [-100, 200], rotate: 270 }],
  ['landscape A4', { size: [842, 595] }],
];

describe('page geometry matches pdf.js viewports', () => {
  for (const [name, spec] of CASES) {
    it(name, async () => {
      const opened = await open(await makePdf([spec]));
      const page = await opened.doc.getPage(1);
      const vp = page.getViewport({ scale: 1 });
      const geom = opened.pages[0]!;
      expect(geom.width).toBeCloseTo(vp.width, 6);
      expect(geom.height).toBeCloseTo(vp.height, 6);
      for (let i = 0; i < 6; i++) expect(geom.toDisplay[i]).toBeCloseTo(vp.transform[i]!, 6);
      // Round trips through user space and agreement with pdf.js point conversion.
      for (const p of [{ x: 0, y: 0 }, { x: 123.4, y: 56.7 }, { x: geom.width, y: geom.height }]) {
        const u = displayToUser(geom, p);
        const [px, py] = vp.convertToViewportPoint(u.x, u.y);
        expect(px).toBeCloseTo(p.x, 6);
        expect(py).toBeCloseTo(p.y, 6);
        const back = userToDisplay(geom, u);
        expect(back.x).toBeCloseTo(p.x, 9);
        expect(back.y).toBeCloseTo(p.y, 9);
      }
      await opened.doc.destroy();
    });
  }
});
