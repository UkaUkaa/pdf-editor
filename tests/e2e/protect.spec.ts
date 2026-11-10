import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createProfile, fixture, launch, openFiles, removeProfile, type Session } from './helpers';

let userData: string;
let session: Session;

const firstPage = (page: Page) => page.locator('.viewer__page[data-page-number="1"]');
const status = (page: Page) => page.getByTestId('document-status');
const menuCommand = (id: string): Promise<void> =>
  session.app.evaluate(({ BrowserWindow }, commandId) => BrowserWindow.getAllWindows()[0]!.webContents.send('menu:command', commandId), id);
const stubSaveDialog = (target: string): Promise<void> =>
  session.app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, target);

/** Reads a saved file with an independent parser. */
async function inspect(path: string, password?: string): Promise<{ text: string[]; encrypted: boolean } | string> {
  try {
    const document = await getDocument({ data: new Uint8Array(await readFile(path)), password, disableFontFace: true }).promise;
    const content = await (await document.getPage(1)).getTextContent();
    const result = {
      text: content.items.flatMap((item) => ('str' in item && item.str.trim() ? [item.str] : [])),
      encrypted: (await document.getPermissions()) !== null,
    };
    await document.loadingTask.destroy();
    return result;
  } catch (error) {
    return (error as Error).name;
  }
}

async function drawRectangle(page: Page): Promise<void> {
  await page.locator('.toolbar__zoom').selectOption('fitPage');
  await expect(firstPage(page)).toBeInViewport({ ratio: 1 });
  await page.locator('[data-action="shapes"]').click();
  await page.getByRole('menuitemcheckbox', { name: 'Rectangle' }).click();
  const box = (await firstPage(page).boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.75, { steps: 5 });
  await page.mouse.up();
  await expect(firstPage(page).locator('.editor-object')).toHaveCount(1);
}

test.beforeEach(async () => {
  userData = await createProfile({ language: 'en', theme: 'light', autosaveInterval: 0 });
  session = await launch(userData);
});

test.afterEach(async () => {
  await session.app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 0;
  });
  await session.app.close().catch(() => undefined);
  await removeProfile(userData);
});

test('protects a PDF with a password, reopens it and removes the protection', async () => {
  const { page } = session;
  await openFiles(session, fixture('mixed-pages.pdf'));
  await expect(firstPage(page).locator('canvas[data-status="ready"]')).toBeVisible();

  await menuCommand('tools.protect');
  const dialog = page.getByRole('dialog', { name: 'Protect with Password' });
  await dialog.getByLabel('Password to open the document').fill('Пароль-2026');
  await dialog.getByLabel('Repeat the password').fill('Пароль-2026');
  await dialog.getByRole('button', { name: 'Protect' }).click();
  await expect(page.getByTestId('status-protection')).toContainText('password');
  await expect(status(page)).toHaveText('Unsaved changes');

  const target = join(userData, 'protected.pdf');
  await stubSaveDialog(target);
  await menuCommand('file.saveAs');
  await expect(page.getByRole('tab', { name: 'protected.pdf' })).toBeVisible();
  await expect(status(page)).toHaveText('No changes');

  // The file really is encrypted: no access without the password, AES-256 inside.
  expect(await inspect(target)).toBe('PasswordException');
  expect(await inspect(target, 'wrong')).toBe('PasswordException');
  expect(await inspect(target, 'Пароль-2026')).toMatchObject({ text: ['Page 1 - A4 portrait'], encrypted: true });
  const raw = (await readFile(target)).toString('latin1');
  expect(raw).toContain('/AESV3');
  expect(raw).not.toContain('Page 1 - A4 portrait');

  // The application itself asks for the password when the file is opened again.
  await menuCommand('file.close');
  await openFiles(session, target);
  const prompt = page.getByRole('dialog', { name: 'Password required' });
  await prompt.getByLabel('Password').fill('Пароль-2026');
  await prompt.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('tab', { name: 'protected.pdf' })).toBeVisible();
  await expect(firstPage(page).locator('canvas[data-status="ready"]')).toBeVisible();
  await expect(page.getByTestId('status-protection')).toContainText('password');

  // Editing and saving in place keeps the protection.
  await drawRectangle(page);
  await menuCommand('file.save');
  await expect(status(page)).toHaveText('No changes');
  expect(await inspect(target)).toBe('PasswordException');
  expect(await inspect(target, 'Пароль-2026')).toMatchObject({ encrypted: true });

  // Removing the protection gives an ordinary file.
  await menuCommand('tools.protect');
  await page.getByRole('dialog', { name: 'Protect with Password' }).getByRole('button', { name: 'Remove Protection' }).click();
  await expect(page.getByTestId('status-protection')).toHaveCount(0);
  const open = join(userData, 'open.pdf');
  await stubSaveDialog(open);
  await menuCommand('file.saveAs');
  await expect(page.getByRole('tab', { name: 'open.pdf' })).toBeVisible();
  expect(await inspect(open)).toMatchObject({ text: ['Page 1 - A4 portrait'], encrypted: false });
  expect(session.errors).toEqual([]);
});

test('edits and saves a file that was already protected, keeping its password', async () => {
  const { page } = session;
  await openFiles(session, fixture('encrypted.pdf'));
  const prompt = page.getByRole('dialog', { name: 'Password required' });
  await prompt.getByLabel('Password').fill('secret');
  await prompt.getByRole('button', { name: 'Open' }).click();
  await expect(firstPage(page).locator('canvas[data-status="ready"]')).toBeVisible();
  await expect(page.getByTestId('status-protection')).toContainText('password');
  const original = await inspect(fixture('encrypted.pdf'), 'secret');

  await drawRectangle(page);
  const target = join(userData, 'edited-secret.pdf');
  await stubSaveDialog(target);
  await menuCommand('file.saveAs');
  await expect(page.getByRole('tab', { name: 'edited-secret.pdf' })).toBeVisible();
  await expect(status(page)).toHaveText('No changes');

  expect(await inspect(target)).toBe('PasswordException');
  expect(await inspect(target, 'secret')).toEqual({ ...(original as object), encrypted: true });
  expect(session.errors).toEqual([]);
});
