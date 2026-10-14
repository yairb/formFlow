import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestFonts } from '../../tests/helpers/fonts';
import {
  addAnnotation,
  appendInkStroke,
  createInkAnnotation,
  createTextAnnotation,
  duplicateAnnotation,
  inkStrokesAbsolute,
  removeAnnotations,
  resizeRect,
  updateAnnotation,
} from './annotations';
import { formatDate, parseIsoDate } from './dates';
import {
  addField,
  changeFieldKind,
  createManualField,
  fieldIsChecked,
  fieldStatus,
  fieldTextValue,
  removeField,
  setFieldChecked,
  setFieldDate,
  setFieldText,
  summarizeFields,
  updateField,
  type FillDefaults,
} from './fields';
import { toCubic, smoothStrokePath } from './paths';
import { EMPTY_MODEL, type TextAnnotation } from './types';

beforeAll(async () => {
  await loadTestFonts();
});

const D: FillDefaults = { fontFamily: 'sans', color: '#111111', dateFormat: 'DD/MM/YYYY', maxFontSize: 12 };
const page = { width: 600, height: 800 };
const opts = { lockAspect: false, minWidth: 4, minHeight: 4, bounds: page };

describe('resizeRect', () => {
  const r = { x: 100, y: 100, width: 100, height: 50 };
  it('keeps the opposite edge fixed', () => {
    expect(resizeRect(r, 'e', 20, 99, opts)).toEqual({ x: 100, y: 100, width: 120, height: 50 });
    expect(resizeRect(r, 'w', 20, 0, opts)).toEqual({ x: 120, y: 100, width: 80, height: 50 });
    expect(resizeRect(r, 'nw', -10, -10, opts)).toEqual({ x: 90, y: 90, width: 110, height: 60 });
  });
  it('enforces minimum size and page bounds', () => {
    expect(resizeRect(r, 'e', -500, 0, opts).width).toBe(4);
    expect(resizeRect(r, 'se', 1000, 1000, opts)).toEqual({ x: 100, y: 100, width: 500, height: 700 });
  });
  it('preserves aspect ratio on corners when locked', () => {
    const out = resizeRect(r, 'se', 100, 0, { ...opts, lockAspect: true });
    expect(out.width / out.height).toBeCloseTo(2, 9);
    expect(out.width).toBeCloseTo(200, 9);
    const nw = resizeRect(r, 'nw', 0, -25, { ...opts, lockAspect: true });
    expect(nw.width / nw.height).toBeCloseTo(2, 9);
    expect(nw.x + nw.width).toBeCloseTo(200, 9);
    expect(nw.y + nw.height).toBeCloseTo(150, 9);
    const clamped = resizeRect({ x: 500, y: 100, width: 50, height: 50 }, 'se', 400, 400, { ...opts, lockAspect: true });
    expect(clamped.x + clamped.width).toBeLessThanOrEqual(600);
    expect(clamped.width).toBeCloseTo(clamped.height, 9);
  });
});

describe('annotations', () => {
  it('sizes text boxes from content and refits on update', () => {
    const t = createTextAnnotation(0, { x: 50, y: 60 }, { fontSize: 12, fontFamily: 'sans', color: '#000' }, { text: 'Hi' });
    expect(t.rect.height).toBeCloseTo(15, 9);
    expect(t.rect.y).toBeCloseTo(60 - 7.5, 9);
    let m = addAnnotation(EMPTY_MODEL, t);
    const w0 = t.rect.width;
    m = updateAnnotation(m, t.id, (a) => ({ ...(a as TextAnnotation), text: 'Hi there\nsecond' }));
    const after = m.annotations[t.id] as TextAnnotation;
    expect(after.rect.width).toBeGreaterThan(w0);
    expect(after.rect.height).toBeCloseTo(30, 9);
  });

  it('duplicates with an offset and removes by id', () => {
    const t = createTextAnnotation(0, { x: 50, y: 60 }, { fontSize: 12, fontFamily: 'sans', color: '#000' }, { text: 'Hi' });
    let m = addAnnotation(EMPTY_MODEL, t);
    m = duplicateAnnotation(m, t.id, { x: 10, y: 10 }, page).model;
    expect(m.annotationOrder.length).toBe(2);
    const copy = m.annotations[m.annotationOrder[1]!]!;
    expect(copy.id).not.toBe(t.id);
    expect(copy.rect.x).toBeGreaterThan(t.rect.x);
    m = removeAnnotations(m, [t.id]);
    expect(m.annotationOrder).toEqual([copy.id]);
  });

  it('keeps ink strokes in place when appending strokes', () => {
    const s1 = [{ x: 10, y: 10 }, { x: 50, y: 20 }];
    const s2 = [{ x: 100, y: 100 }, { x: 120, y: 140 }];
    const ink = appendInkStroke(createInkAnnotation(0, s1, '#000', 2), s2);
    const abs = inkStrokesAbsolute(ink);
    expect(abs[0]![1]!.x).toBeCloseTo(50, 1);
    expect(abs[1]![1]!.y).toBeCloseTo(140, 1);
    expect(ink.rect.x).toBeCloseTo(9, 2);
  });

  it('converts quadratic stroke segments to equivalent cubics', () => {
    const path = toCubic(smoothStrokePath([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }]));
    expect(path.some((c) => c.op === 'Q')).toBe(false);
    const c = path[1]!;
    expect(c.op).toBe('C');
  });
});

describe('dates', () => {
  it('formats ISO dates', () => {
    expect(formatDate('2026-03-04', 'MM/DD/YYYY')).toBe('03/04/2026');
    expect(formatDate('2026-03-04', 'DD.MM.YYYY')).toBe('04.03.2026');
    expect(formatDate('2026-03-04', 'D MMMM YYYY')).toBe('4 March 2026');
    expect(parseIsoDate('2026-13-01')).toBeNull();
  });
});

describe('fields', () => {
  const line = { ...createManualField(0, { x: 100, y: 200, width: 200, height: 14 }, 'text'), shape: 'line' as const };
  const box = createManualField(0, { x: 100, y: 300, width: 14, height: 14 }, 'checkbox');

  it('fills text, shrinking the font so single-line values fit', () => {
    let m = addField(addField(EMPTY_MODEL, line), box);
    m = setFieldText(m, line, 'Jane Doe', D);
    expect(fieldTextValue(m, line.id)).toBe('Jane Doe');
    expect(fieldStatus(m, line)).toBe('filled');
    const long = 'A very long value that certainly does not fit on a two hundred point line at all';
    m = setFieldText(m, line, long, D);
    const t = Object.values(m.annotations)[0] as TextAnnotation;
    expect(t.fontSize).toBeLessThan(9);
    // Sits on the line (bottom aligned) inside the field horizontally.
    expect(t.rect.y + t.rect.height).toBeCloseTo(line.rect.y + line.rect.height - 1, 6);
    expect(t.rect.x).toBeGreaterThanOrEqual(line.rect.x);
    expect(Object.keys(m.annotations).length).toBe(1);
  });

  it('checks and unchecks', () => {
    let m = addField(EMPTY_MODEL, box);
    m = setFieldChecked(m, box, true, '#000');
    expect(fieldIsChecked(m, box.id)).toBe(true);
    m = setFieldChecked(m, box, true, '#000');
    expect(Object.keys(m.annotations).length).toBe(1);
    m = setFieldChecked(m, box, false, '#000');
    expect(fieldIsChecked(m, box.id)).toBe(false);
  });

  it('summarizes progress including skipped and N/A', () => {
    let m = addField(addField(EMPTY_MODEL, line), box);
    m = setFieldText(m, line, 'x', D);
    expect(summarizeFields(m)).toMatchObject({ total: 2, filled: 1, remaining: 1 });
    m = updateField(m, box.id, { notApplicable: true });
    expect(summarizeFields(m)).toMatchObject({ total: 2, filled: 1, remaining: 0, na: 1 });
  });

  it('keeps text across text/date conversions and clears otherwise', () => {
    let m = addField(EMPTY_MODEL, line);
    m = setFieldDate(m, line, '2026-01-02', 'YYYY-MM-DD', D);
    expect(fieldTextValue(m, line.id)).toBe('2026-01-02');
    m = changeFieldKind(m, line.id, 'text', D);
    expect(fieldTextValue(m, line.id)).toBe('2026-01-02');
    m = changeFieldKind(m, line.id, 'checkbox', D);
    expect(Object.keys(m.annotations).length).toBe(0);
  });

  it('removing a field keeps its value as a free annotation', () => {
    let m = addField(EMPTY_MODEL, line);
    m = setFieldText(m, line, 'keep me', D);
    m = removeField(m, line.id);
    expect(m.fieldOrder).toEqual([]);
    const a = Object.values(m.annotations)[0] as TextAnnotation;
    expect(a.text).toBe('keep me');
    expect(a.fieldId).toBeUndefined();
  });
});
