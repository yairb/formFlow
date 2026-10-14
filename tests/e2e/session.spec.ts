import { expect, test } from '@playwright/test';
import { exportPdf, fillCounter, pdfText, prepare } from './helpers';

test('progress survives a reload and is restored from recents', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Try a sample form' }).click();
  await fillCounter(page).click();
  await page.keyboard.type('Kept across sessions');
  await page.keyboard.press('Enter');
  await expect(fillCounter(page)).toContainText('1/54');
  // Autosave is debounced; wait for the saved state before reloading.
  await expect(page.getByText('Saved on this device')).toBeVisible({ timeout: 10_000 });

  await page.reload();
  const recent = page.getByRole('button', { name: /Sample: Rental application/ });
  await expect(recent).toBeVisible();
  await recent.click();
  const resume = page.getByRole('dialog', { name: 'Resume where you left off?' });
  await resume.getByRole('button', { name: 'Restore' }).click();
  await expect(fillCounter(page)).toContainText('1/54');
  expect((await pdfText((await exportPdf(page)).bytes)).text).toContain('Kept across sessions');
});

test('starting fresh discards the saved progress', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Try a sample form' }).click();
  await fillCounter(page).click();
  await page.keyboard.type('Throwaway');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Saved on this device')).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await page.getByRole('button', { name: /Sample: Rental application/ }).click();
  await page.getByRole('dialog', { name: 'Resume where you left off?' }).getByRole('button', { name: 'Start fresh' }).click();
  await expect(fillCounter(page)).toContainText('0/54');
});
