import { expect, test } from '@playwright/test';
import { exportPdf, fillCounter, fixture, imagePaints, openFile, pdfText, prepare } from './helpers';

test.beforeEach(async ({ page }) => prepare(page));

test('guided filling of the sample form exports a flattened copy with the values as text', async ({ page }) => {
  await page.getByRole('button', { name: 'Try a sample form' }).click();
  await expect(fillCounter(page)).toContainText('0/54');
  await fillCounter(page).click();

  const position = page.getByTestId('guided-position');
  await expect(position).toHaveText('Field 1 of 54');
  await expect(page.getByRole('textbox', { name: 'Value for Property address applied for' })).toBeFocused();
  await page.keyboard.type('221B Baker Street');
  await page.keyboard.press('Enter');
  await expect(position).toHaveText('Field 2 of 54');
  await page.keyboard.type('4B');
  await page.keyboard.press('Enter');
  await expect(position).toHaveText('Field 3 of 54');
  await expect(fillCounter(page)).toContainText('2/54');
  await expect(page.getByRole('status', { name: 'Unexported changes' })).toBeVisible();

  // Export with fields left empty goes through the review step.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PDF', exact: true }).click();
  const review = page.getByRole('dialog');
  await expect(review).toContainText('Still empty');
  await page.getByTestId('review-export').click();
  const d = await download;
  expect(d.suggestedFilename()).toBe('rental-application-sample-filled.pdf');

  const { readFile } = await import('node:fs/promises');
  const out = await pdfText(new Uint8Array(await readFile(await d.path())));
  expect(out.pages).toBe(2);
  expect(out.text).toContain('221B Baker Street');
  expect(out.text).toContain('4B');
});

test('native AcroForm fields are detected, filled and flattened on export', async ({ page }) => {
  await openFile(page, 'acroform-mixed.pdf', await fixture('acroform-mixed.pdf'));
  await expect(page.getByTestId('workspace')).toBeVisible();
  await fillCounter(page).click();
  const box = page.getByRole('textbox', { name: 'Value for Borrower' });
  await expect(box).toBeFocused();
  await page.keyboard.type('Noa Cohen');
  await page.keyboard.press('Enter');

  const { name, bytes } = await exportPdf(page);
  expect(name).toBe('acroform-mixed-filled.pdf');
  const out = await pdfText(bytes);
  expect(out.text).toContain('Noa Cohen');
  // The filled field is flattened into page content; the two untouched native
  // fields stay interactive (3 widgets in the source).
  expect(out.fields).toBe(2);
});

test('Hebrew values export as extractable Unicode text', async ({ page }) => {
  await openFile(page, 'hebrew-membership.pdf', await fixture('hebrew-membership.pdf'));
  await fillCounter(page).click();
  await expect(page.getByRole('textbox', { name: /^Value for/ })).toBeFocused();
  await page.keyboard.type('דנה לוי');
  await page.keyboard.press('Enter');

  const out = await pdfText((await exportPdf(page)).bytes);
  const reversed = [...'דנה לוי'].reverse().join('');
  expect(out.text.includes('דנה לוי') || out.text.includes(reversed)).toBe(true);
});

test('a drawn signature is placed and exported as an image', async ({ page }) => {
  await page.getByRole('button', { name: 'Try a sample form' }).click();
  await expect(page.getByTestId('workspace')).toBeVisible();
  await page.keyboard.press('s');
  const pageBox = (await page.getByRole('region', { name: 'Page 1 of 2' }).boundingBox())!;
  await page.mouse.click(pageBox.x + pageBox.width * 0.3, pageBox.y + pageBox.height * 0.45);

  const dialog = page.getByRole('dialog');
  const pad = dialog.getByLabel(/^Signature drawing area/);
  await expect(pad).toBeVisible();
  const b = (await pad.boundingBox())!;
  await page.mouse.move(b.x + 30, b.y + b.height * 0.6);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(b.x + 30 + i * 12, b.y + b.height * (0.6 - Math.sin(i / 3) * 0.25));
  await page.mouse.up();
  await dialog.getByRole('button', { name: 'Sign', exact: true }).click();
  await expect(dialog).toBeHidden();

  const before = await imagePaints(new Uint8Array(await (await import('node:fs/promises')).readFile(new URL('../fixtures/out/rental-application.pdf', import.meta.url))));
  const { bytes } = await exportPdf(page);
  expect(await imagePaints(bytes)).toBeGreaterThan(before);
});

test('undo and redo restore field values', async ({ page }) => {
  await page.getByRole('button', { name: 'Try a sample form' }).click();
  await fillCounter(page).click();
  await page.keyboard.type('Temporary');
  await page.keyboard.press('Enter');
  await expect(fillCounter(page)).toContainText('1/54');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(fillCounter(page)).toContainText('0/54');
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(fillCounter(page)).toContainText('1/54');
});
