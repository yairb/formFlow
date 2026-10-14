import { expect, test } from '@playwright/test';
import { makeEncryptedPdf } from '../helpers/encrypted';
import { openFile, prepare } from './helpers';

test.beforeEach(async ({ page }) => prepare(page));

test('a non-PDF file shows a clear error and keeps the start screen', async ({ page }) => {
  await openFile(page, 'notes.pdf', Buffer.from('just some text, not a PDF'));
  await expect(page.getByText('Couldn’t open “notes.pdf”')).toBeVisible();
  await expect(page.getByText('This file is not a PDF document.')).toBeVisible();
  await expect(page.getByTestId('open-pdf')).toBeVisible();
});

test('an empty file is reported as empty', async ({ page }) => {
  await openFile(page, 'empty.pdf', Buffer.alloc(0));
  await expect(page.getByText('The file is empty.')).toBeVisible();
});

test('a damaged PDF is reported as damaged', async ({ page }) => {
  await openFile(page, 'broken.pdf', Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >>\n%%garbage'));
  await expect(page.getByText('This PDF is damaged and could not be read.')).toBeVisible();
});

test('a password-protected PDF prompts, rejects a wrong password and opens with the right one', async ({ page }) => {
  await openFile(page, 'secured.pdf', makeEncryptedPdf({ userPassword: 'formflow' }));
  const dialog = page.getByRole('dialog', { name: /Password required/ });
  await expect(dialog).toBeVisible();
  const input = dialog.getByLabel('Document password');
  await input.fill('wrong');
  await input.press('Enter');
  await expect(dialog.getByText('That password didn’t work. Try again.')).toBeVisible();
  await dialog.getByLabel('Document password').fill('formflow');
  await dialog.getByLabel('Document password').press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('region', { name: 'Page 1 of 1' })).toBeVisible();
});
