import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** Removes the File System Access pickers so the app uses <input type=file> and a.download,
 *  which Playwright can drive through filechooser and download events. */
export async function prepare(page: Page) {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  });
  await page.goto('/');
  await expect(page.getByTestId('open-pdf')).toBeVisible();
}

export async function openFile(page: Page, name: string, bytes: Uint8Array | Buffer) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('open-pdf').click();
  await (await chooser).setFiles({ name, mimeType: 'application/pdf', buffer: Buffer.from(bytes) });
}

export const fixture = (name: string) => readFile(new URL(`../fixtures/out/${name}`, import.meta.url));

/** Clicks Export (through the review dialog when it appears) and returns the saved bytes. */
export async function exportPdf(page: Page): Promise<{ name: string; bytes: Uint8Array }> {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PDF', exact: true }).first().click();
  const review = page.getByTestId('review-export');
  if (await review.isVisible({ timeout: 1500 }).catch(() => false)) await review.click();
  const d = await download;
  const path = await d.path();
  return { name: d.suggestedFilename(), bytes: new Uint8Array(await readFile(path)) };
}

export async function pdfText(bytes: Uint8Array): Promise<{ text: string; pages: number; fields: number }> {
  const doc = await getDocument({ data: bytes.slice(), useSystemFonts: false, verbosity: 0 }).promise;
  let text = '';
  let fields = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => ('str' in it ? it.str : '')).join(' ') + '\n';
    fields += (await page.getAnnotations()).filter((a) => a.subtype === 'Widget').length;
  }
  const pages = doc.numPages;
  await doc.destroy();
  return { text, pages, fields };
}

/** Counts image paint operations on each page (signatures are embedded as images). */
export async function imagePaints(bytes: Uint8Array): Promise<number> {
  const { OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  let n = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const ops = await (await doc.getPage(i)).getOperatorList();
    n += ops.fnArray.filter((f) => f === OPS.paintImageXObject).length;
  }
  await doc.destroy();
  return n;
}

export const fillCounter = (page: Page) => page.getByRole('button', { name: /^Fill form/ });
