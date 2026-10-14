import type { SignatureImage } from '@/model/types';

/**
 * Turning drawn strokes, typed names and uploaded pictures into transparent,
 * tightly cropped PNG signature images. The pixel functions are pure so they can
 * be unit-tested without a canvas.
 */

export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Smallest box containing every pixel with alpha above `minAlpha`, or null when empty. */
export function alphaBounds(px: Pixels, minAlpha = 8): Bounds | null {
  let x0 = px.width;
  let y0 = px.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < px.height; y++) {
    for (let x = 0; x < px.width; x++) {
      if (px.data[(y * px.width + x) * 4 + 3]! > minAlpha) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/**
 * Makes a photographed or scanned signature's paper transparent: light pixels
 * fade out, dark ink keeps its colour. `paper` is the luminance treated as fully
 * background (0..255); pixels between `ink` and `paper` get partial alpha so
 * stroke edges stay smooth.
 */
export function removeLightBackground(px: Pixels, paper = 225, ink = 150): Pixels {
  const out = new Uint8ClampedArray(px.data);
  for (let i = 0; i < out.length; i += 4) {
    const lum = 0.2126 * out[i]! + 0.7152 * out[i + 1]! + 0.0722 * out[i + 2]!;
    let alpha: number;
    if (lum >= paper) alpha = 0;
    else if (lum <= ink) alpha = 1;
    else alpha = (paper - lum) / (paper - ink);
    out[i + 3] = Math.round(out[i + 3]! * alpha);
  }
  return { data: out, width: px.width, height: px.height };
}

/** True when the image already has meaningful transparency (e.g. a PNG cut-out). */
export function hasTransparency(px: Pixels): boolean {
  let transparent = 0;
  const total = px.width * px.height;
  for (let i = 3; i < px.data.length; i += 4) if (px.data[i]! < 250) transparent++;
  return transparent / Math.max(1, total) > 0.05;
}

export const MAX_SIGNATURE_PX = 1200;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** Crops a canvas to its visible content (plus padding) and encodes it as a PNG signature image. */
export function canvasToSignature(canvas: HTMLCanvasElement, pad = 6): SignatureImage | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const px = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const b = alphaBounds(px);
  if (!b) return null;
  const x = Math.max(0, b.x - pad);
  const y = Math.max(0, b.y - pad);
  const w = Math.min(canvas.width - x, b.width + pad * 2);
  const h = Math.min(canvas.height - y, b.height + pad * 2);
  const k = Math.min(1, MAX_SIGNATURE_PX / Math.max(w, h));
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(w * k));
  out.height = Math.max(1, Math.round(h * k));
  const octx = out.getContext('2d')!;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(canvas, x, y, w, h, 0, 0, out.width, out.height);
  return { dataUrl: out.toDataURL('image/png'), pixelWidth: out.width, pixelHeight: out.height };
}

export const SIGNATURE_FONTS = [
  { id: 'dancing', label: 'Flowing', css: "'FF Sig Dancing'", weight: 600 },
  { id: 'caveat', label: 'Handwritten', css: "'FF Sig Caveat'", weight: 500 },
  { id: 'vibes', label: 'Formal', css: "'FF Sig Vibes'", weight: 400 },
] as const;

export type SignatureFontId = (typeof SIGNATURE_FONTS)[number]['id'];

/** Renders a typed name in a script font. */
export async function typedSignature(name: string, fontId: SignatureFontId, color: string): Promise<SignatureImage | null> {
  const font = SIGNATURE_FONTS.find((f) => f.id === fontId)!;
  const size = 120;
  const spec = `${font.weight} ${size}px ${font.css}`;
  await document.fonts.load(spec, name);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = spec;
  const width = Math.ceil(ctx.measureText(name).width + size);
  canvas.width = Math.min(4000, width);
  canvas.height = Math.round(size * 1.9);
  ctx.font = spec;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.direction = 'inherit';
  ctx.fillText(name, size / 2, canvas.height / 2);
  return canvasToSignature(canvas);
}

/** Decodes an uploaded image file, removes a light background, and crops it. */
export async function imageFileToSignature(file: File): Promise<SignatureImage> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Choose a PNG, JPEG or WebP image.');
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('That image is larger than 8 MB.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('That image couldn’t be read.');
  }
  const k = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * k));
  canvas.height = Math.max(1, Math.round(bitmap.height * k));
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const px = ctx.getImageData(0, 0, canvas.width, canvas.height);
  if (!hasTransparency(px)) {
    const cleaned = removeLightBackground(px);
    ctx.putImageData(new ImageData(cleaned.data as Uint8ClampedArray<ArrayBuffer>, cleaned.width, cleaned.height), 0, 0);
  }
  const sig = canvasToSignature(canvas);
  if (!sig) throw new Error('No signature was found in that image — it looks blank.');
  return sig;
}
