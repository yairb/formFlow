import { describe, expect, it } from 'vitest';
import { findSpaceBlanks, findUnderscoreBlanks, groupPhrases, type Phrase } from './textStage';
import type { TextRun } from './primitives';

const run = (str: string, x: number, baseline: number, width: number, fontSize = 10, rtl = false): TextRun => ({
  str,
  rect: { x, y: baseline - fontSize * 0.8, width, height: fontSize },
  fontSize,
  rtl,
});

describe('groupPhrases', () => {
  it('joins runs separated by a word gap and keeps distant runs apart', () => {
    const p = groupPhrases([run('Full', 50, 100, 18), run('name', 71, 100, 24), run('Phone', 300, 100, 28)]);
    expect(p.map((q) => q.text)).toEqual(['Full name', 'Phone']);
  });

  it('prepends right-hand runs for RTL lines (logical order)', () => {
    // Visual order: "משפחה" (left) "שם" (right) — logical "שם משפחה".
    const p = groupPhrases([run('משפחה', 100, 100, 30, 10, true), run('שם', 133, 100, 12, 10, true)]);
    expect(p[0]!.text).toBe('שם משפחה');
  });

  it('groups by baseline, not by top edge', () => {
    const p = groupPhrases([run('Name', 50, 100, 24, 10), run('(print)', 76, 100.5, 26, 7)]);
    expect(p).toHaveLength(1);
  });
});

describe('findUnderscoreBlanks', () => {
  const phrase = (text: string, x: number, width: number, rtl = false): Phrase => ({ text, rect: { x, y: 92, width, height: 10 }, fontSize: 10, rtl });

  it('labels each blank with the text before it', () => {
    const { blanks } = findUnderscoreBlanks([phrase('Name: __________   Date: ______', 50, 200)]);
    expect(blanks.map((b) => b.label)).toEqual(['Name', 'Date']);
    expect(blanks[0]!.rect.x).toBeGreaterThan(60);
    expect(blanks[1]!.rect.x).toBeGreaterThan(blanks[0]!.rect.x + blanks[0]!.rect.width);
  });

  it('treats dot leaders as blanks', () => {
    const { blanks } = findUnderscoreBlanks([phrase('Member name ..................', 50, 150)]);
    expect(blanks).toHaveLength(1);
    expect(blanks[0]!.label).toBe('Member name');
  });

  it('mirrors positions for RTL phrases', () => {
    const { blanks } = findUnderscoreBlanks([phrase('שם: __________', 300, 100, true)]);
    // The label is on the right, so the blank occupies the left part.
    expect(blanks[0]!.label).toBe('שם');
    expect(blanks[0]!.rect.x).toBeLessThan(310);
  });
});

describe('findSpaceBlanks', () => {
  it('finds open space after a colon label', () => {
    const b = findSpaceBlanks([{ text: 'Phone:', rect: { x: 50, y: 92, width: 30, height: 10 }, fontSize: 10, rtl: false }], { width: 612 });
    expect(b).toHaveLength(1);
    expect(b[0]!.rect.x).toBeGreaterThan(80);
  });

  it('skips a colon heading that introduces text below it', () => {
    const b = findSpaceBlanks(
      [
        { text: 'Instructions:', rect: { x: 50, y: 92, width: 60, height: 10 }, fontSize: 10, rtl: false },
        { text: 'Complete every line in block capitals.', rect: { x: 50, y: 106, width: 200, height: 10 }, fontSize: 10, rtl: false },
      ],
      { width: 612 },
    );
    expect(b).toEqual([]);
  });
});
