import { describe, expect, it } from 'vitest';
import { alphaBounds, hasTransparency, removeLightBackground, type Pixels } from './image';

function solid(width: number, height: number, rgba: [number, number, number, number]): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { data, width, height };
}

function setPx(p: Pixels, x: number, y: number, rgba: [number, number, number, number]) {
  p.data.set(rgba, (y * p.width + x) * 4);
}

describe('signature image processing', () => {
  it('finds the bounds of visible pixels', () => {
    const p = solid(10, 8, [0, 0, 0, 0]);
    setPx(p, 2, 3, [0, 0, 0, 255]);
    setPx(p, 6, 5, [0, 0, 0, 255]);
    expect(alphaBounds(p)).toEqual({ x: 2, y: 3, width: 5, height: 3 });
    expect(alphaBounds(solid(4, 4, [0, 0, 0, 0]))).toBeNull();
  });

  it('turns white paper transparent and keeps dark ink opaque', () => {
    const p = solid(3, 1, [255, 255, 255, 255]);
    setPx(p, 1, 0, [20, 30, 90, 255]);
    setPx(p, 2, 0, [190, 190, 190, 255]);
    const out = removeLightBackground(p);
    expect(out.data[3]).toBe(0);
    expect(out.data[7]).toBe(255);
    expect(out.data[11]).toBeGreaterThan(0);
    expect(out.data[11]).toBeLessThan(255);
    // Colour channels are untouched.
    expect([...out.data.slice(4, 7)]).toEqual([20, 30, 90]);
  });

  it('detects existing transparency', () => {
    expect(hasTransparency(solid(4, 4, [255, 255, 255, 255]))).toBe(false);
    expect(hasTransparency(solid(4, 4, [0, 0, 0, 0]))).toBe(true);
  });
});
