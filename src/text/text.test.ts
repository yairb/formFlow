import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestFonts } from '../../tests/helpers/fonts';
import { paragraphDirection, toLogicalOrder, toVisualOrder } from './bidi';
import { splitFontRuns, type FontLibrary } from './fonts';
import { layoutText, measureWith } from './layout';
import { baselineOffset } from './metrics';
import { lineOffsetX, positionLineRuns } from './runs';

let lib: FontLibrary;
beforeAll(async () => {
  lib = await loadTestFonts();
});

describe('bidi', () => {
  it('detects paragraph direction from the first strong character', () => {
    expect(paragraphDirection('Hello')).toBe('ltr');
    expect(paragraphDirection('123 שלום')).toBe('rtl');
    expect(paragraphDirection('  (שם) Name')).toBe('rtl');
    expect(paragraphDirection('2024-01-01')).toBe('ltr');
  });

  it('reorders mixed text into visual order with mirrored brackets', () => {
    expect(toVisualOrder('abc', 'ltr')).toBe('abc');
    expect(toVisualOrder('שלום', 'rtl')).toBe('םולש');
    // Latin and numbers after Latin (rule W7) form one LTR run inside RTL text.
    expect(toVisualOrder('שם: John 42', 'rtl')).toBe('John 42 :םש');
    expect(toVisualOrder('(א)', 'rtl')).toBe('(א)');
  });
});

describe('font runs', () => {
  it('splits Hebrew from other characters', () => {
    expect(splitFontRuns('Ab שלום!', 'sans', true).map((r) => [r.text, r.face])).toEqual([
      ['Ab ', 'sans-bold'],
      ['שלום', 'sans-hebrew-bold'],
      ['!', 'sans-bold'],
    ]);
    // Serif has no bold face; it falls back to regular.
    expect(splitFontRuns('A', 'serif', true)[0]!.face).toBe('serif-regular');
  });

  it('positions runs left to right and gives RTL runs in logical order', () => {
    const runs = positionLineRuns({ text: 'שלום abc', direction: 'rtl' }, 'sans', false, 10, lib);
    expect(runs.map((r) => r.text)).toEqual(['abc ', 'שלום']);
    expect(runs[0]!.x).toBe(0);
    expect(runs[1]!.x).toBeCloseTo(runs[0]!.width, 9);
    const total = runs.reduce((s, r) => s + r.width, 0);
    expect(total).toBeCloseTo(lib.measure('שלום abc', 'sans', false, 10), 9);
  });
});

describe('layout', () => {
  it('measures with the bundled font advances (no kerning)', () => {
    const w = lib.measure('AV', 'sans', false, 10);
    expect(w).toBeCloseTo(lib.measure('A', 'sans', false, 10) + lib.measure('V', 'sans', false, 10), 9);
    expect(lib.measure('Hello', 'sans', false, 20)).toBeCloseTo(lib.measure('Hello', 'sans', false, 10) * 2, 9);
  });

  it('keeps explicit lines for auto-width text', () => {
    const style = { family: 'sans' as const, bold: false, size: 12 };
    const l = layoutText('one\ntwo words\n\nend ', style, null, measureWith(lib, style));
    expect(l.lines.map((x) => x.text)).toEqual(['one', 'two words', '', 'end ']);
    expect(l.lines[3]!.width).toBeCloseTo(lib.measure('end', 'sans', false, 12), 9);
    expect(l.height).toBeCloseTo(4 * 15, 9);
  });

  it('wraps greedily at word boundaries and breaks long words', () => {
    const style = { family: 'sans' as const, bold: false, size: 10 };
    const m = measureWith(lib, style);
    const max = m('hello world');
    const l = layoutText('hello world again and again', style, max, m);
    expect(l.lines.map((x) => x.text.trim())).toEqual(['hello world', 'again and', 'again']);
    for (const line of l.lines) expect(line.width).toBeLessThanOrEqual(max + 0.01);
    const long = layoutText('abcdefghijklmnopqrstuvwxyz', style, m('abcdefgh'), m);
    expect(long.lines.length).toBeGreaterThan(2);
    expect(long.lines.map((x) => x.text).join('')).toBe('abcdefghijklmnopqrstuvwxyz');
  });

  it('computes alignment offsets and baselines', () => {
    expect(lineOffsetX('left', 100, 40)).toBe(0);
    expect(lineOffsetX('center', 100, 40)).toBe(30);
    expect(lineOffsetX('right', 100, 40)).toBe(60);
    // Half-leading + ascent with the forced font metrics.
    expect(baselineOffset(10)).toBeCloseTo(((1.25 - 1.362) / 2 + 1.069) * 10, 9);
  });

  it('reports characters missing from the fonts', () => {
    expect(lib.unsupportedCharacters('Grüße שלום Привет', 'sans', false)).toEqual([]);
    expect(lib.unsupportedCharacters('漢字 ok', 'sans', false)).toEqual(['漢', '字']);
  });
});

describe('toLogicalOrder', () => {
  it('reverses a page whose Hebrew runs were extracted in visual order', () => {
    // Visual order of "שם פרטי", "תעודת זהות" (finals at word starts give it away).
    const visual = ['יטרפ םש', 'תוהז תדועת', 'Page 1'];
    expect(toLogicalOrder(visual)).toEqual(['שם פרטי', 'תעודת זהות', 'Page 1']);
  });

  it('leaves logical runs, and runs without evidence, unchanged', () => {
    expect(toLogicalOrder(['שם פרטי', 'כתובת'])).toEqual(['שם פרטי', 'כתובת']);
    expect(toLogicalOrder(['כתובת'])).toEqual(['כתובת']);
  });
});
