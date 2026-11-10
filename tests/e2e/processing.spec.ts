import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createProfile, fixture, launch, openFiles, removeProfile, type Session } from './helpers';

let userData: string;
let session: Session;

const firstPage = (page: Page) => page.locator('.viewer__page[data-page-number="1"]');
const menuCommand = (id: string): Promise<void> =>
  session.app.evaluate(({ BrowserWindow }, commandId) => {
    BrowserWindow.getAllWindows()[0]!.webContents.send('menu:command', commandId);
  }, id);
const stubOpenDialog = (paths: string[]): Promise<void> =>
  session.app.evaluate(({ dialog }, filePaths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths });
  }, paths);

async function saveAs(target: string, tabName: string): Promise<void> {
  await session.app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, target);
  await menuCommand('file.saveAs');
  await expect(session.page.getByRole('tab', { name: tabName })).toBeVisible();
  await expect(session.page.getByTestId('document-status')).toHaveText('No changes');
}

async function textOf(path: string, pageNumber: number): Promise<string[]> {
  const document = await getDocument({
    data: new Uint8Array(await readFile(path)),
    disableFontFace: true,
    standardFontDataUrl: `${resolve('node_modules/pdfjs-dist/standard_fonts')}/`,
  }).promise;
  const content = await (await document.getPage(pageNumber)).getTextContent();
  const lines = content.items.flatMap((item) => ('str' in item && item.str.trim() ? [item.str] : []));
  await document.loadingTask.destroy();
  return lines;
}

test.beforeEach(async () => {
  userData = await createProfile({ language: 'en', theme: 'light' });
  session = await launch(userData);
});

test.afterEach(async () => {
  await session.app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 0;
  });
  await session.app.close().catch(() => undefined);
  await removeProfile(userData);
});

test('exports pages as images, recognises a scanned page and makes it searchable', async () => {
  test.setTimeout(180_000);
  const { page, errors } = session;
  await openFiles(session, fixture('mixed-pages.pdf'));
  await expect(firstPage(page).locator('canvas[data-status="ready"]')).toBeVisible();

  // --- Export the pages as PNG images at 150 dpi ------------------------------------------
  await stubOpenDialog([userData]);
  await menuCommand('file.exportImages');
  const dialog = page.getByRole('dialog', { name: 'Export pages as images' });
  await dialog.getByRole('button', { name: 'Choose Folder and Export' }).click();
  const exported = page.getByRole('dialog', { name: 'Pages exported' });
  await expect(exported).toContainText('Files created: 3');
  await exported.getByRole('button', { name: 'OK' }).click();
  const images = (await readdir(userData)).filter((name) => name.endsWith('.png')).sort();
  expect(images).toEqual(['mixed-pages-1.png', 'mixed-pages-2.png', 'mixed-pages-3.png']);
  const png = await readFile(join(userData, 'mixed-pages-1.png'));
  // A real PNG of the right size: A4 (595.28 x 841.89 pt) at 150 dpi is 1240 x 1753 whole pixels.
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  expect(png.readUInt32BE(16)).toBe(1240);
  expect(png.readUInt32BE(20)).toBe(1753);

  // --- A "scan": a new document whose only page is that image ------------------------------
  await page.getByRole('button', { name: 'Close mixed-pages.pdf' }).click();
  await stubOpenDialog([join(userData, 'mixed-pages-1.png')]);
  await menuCommand('pages.importImages');
  await expect(page.getByRole('tab', { name: /Untitled\.pdf/ })).toBeVisible();
  await expect(firstPage(page).locator('canvas[data-status="ready"]')).toBeVisible();

  // An image has no text: the search finds nothing.
  await menuCommand('edit.find');
  const search = page.getByRole('searchbox', { name: 'Search in document' });
  await search.fill('portrait');
  await expect(page.getByTestId('search-status')).toHaveText('Nothing found');

  // --- OCR ------------------------------------------------------------------------------
  // The options dialog is still there, with the languages from the preferences.
  await menuCommand('tools.ocr');
  const ocr = page.getByRole('dialog', { name: 'Recognize text (OCR)' });
  await expect(ocr.getByRole('checkbox', { name: 'English' })).toBeChecked();
  await ocr.getByRole('button', { name: 'Cancel' }).click();

  // The quick way: the toolbar button, "this page". Progress shows while the real engine works.
  await page.locator('[data-action="ocr"]').click();
  const menu = page.getByRole('menu', { name: 'Recognize text (OCR)' });
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Recognize Text on This Page',
    'Recognize Text in the Whole Document',
    'Text Recognition Options…',
  ]);
  await menu.getByRole('menuitem', { name: 'Recognize Text on This Page' }).click();
  await expect(ocr.getByRole('status')).toContainText('Recognizing page 1 of 1');
  const done = page.getByRole('dialog', { name: 'Text recognition finished' });
  await expect(done).toContainText('Pages with recognised text: 1 of 1', { timeout: 120_000 });
  await expect(ocr).toHaveCount(0);
  await done.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('document-status')).toHaveText('Unsaved changes');

  // The recognised text is found, and the highlight lies on the words in the middle of the page.
  await expect(page.getByTestId('search-status')).toHaveText('1 of 1');
  await expect(page.locator('.search-result')).toContainText('A4 portrait');
  const hit = firstPage(page).locator('.search-hit');
  await expect(hit).toBeVisible();
  const pageBox = (await firstPage(page).boundingBox())!;
  const hitBox = (await hit.boundingBox())!;
  const centreX = (hitBox.x + hitBox.width / 2 - pageBox.x) / pageBox.width;
  const centreY = (hitBox.y + hitBox.height / 2 - pageBox.y) / pageBox.height;
  // "portrait" ends the line that starts at x = 60 pt and runs to about 332 pt of 595; the baseline is at half height.
  expect(centreX).toBeGreaterThan(0.35);
  expect(centreX).toBeLessThan(0.6);
  expect(centreY).toBeGreaterThan(0.44);
  expect(centreY).toBeLessThan(0.54);

  // Undo removes the recognised text; redo brings it back.
  await page.locator('[data-command="edit.undo"]').first().click();
  await expect(page.getByTestId('search-status')).toHaveText('Nothing found');
  await page.locator('[data-command="edit.redo"]').first().click();
  await expect(page.getByTestId('search-status')).toHaveText('1 of 1');

  // --- Saved: the scan now carries an invisible, extractable text layer ------------------------
  const target = join(userData, 'searchable.pdf');
  await saveAs(target, 'searchable.pdf');
  expect((await textOf(target, 1)).join(' ')).toContain('Page 1 - A4 portrait');
  expect(errors).toEqual([]);

  await session.app.close();
  session = await launch(userData);
  await session.page.locator('.recent-item', { hasText: 'searchable.pdf' }).click();
  await expect(firstPage(session.page).locator('canvas[data-status="ready"]')).toBeVisible();
  await session.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.send('menu:command', 'edit.find'));
  await session.page.getByRole('searchbox', { name: 'Search in document' }).fill('portrait');
  await expect(session.page.getByTestId('search-status')).toHaveText('1 of 1');
  // The text layer is invisible: the page still looks like the scan (white where there is no ink).
  const stillImage = await session.page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.viewer__page[data-page-number="1"] canvas')!;
    const data = canvas.getContext('2d')!.getImageData(Math.floor(canvas.width * 0.9), Math.floor(canvas.height * 0.9), 1, 1).data;
    return [data[0], data[1], data[2]];
  });
  expect(stillImage).toEqual([255, 255, 255]);
  expect(session.errors).toEqual([]);
});

test('finds and replaces text on pages and in added objects', async () => {
  const { page, errors } = session;
  await openFiles(session, fixture('mixed-pages.pdf'));
  await expect(firstPage(page).locator('canvas[data-status="ready"]')).toBeVisible();
  await page.locator('.toolbar__zoom').selectOption('fitPage');

  // A text object of my own that also contains the word.
  await page.locator('.toolbar [data-command="insert.text"]').click();
  const box = (await firstPage(page).boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.15);
  await page.keyboard.type('Second Page note');
  await page.keyboard.press('Escape');

  await menuCommand('edit.findReplace');
  await page.getByRole('searchbox', { name: 'Search in document' }).fill('Page');
  // Three page titles (one of them rotated on its page) and my note.
  await expect(page.getByTestId('search-status')).toHaveText('1 of 4');
  await expect(page.locator('.search')).toContainText('The old text stays in the file underneath');
  await page.getByLabel('Replace with').fill('Sheet');

  // Replace the current match only: the object's own text is edited directly.
  await page.getByRole('button', { name: 'Replace', exact: true }).click();
  await expect(page.getByTestId('search-status')).toHaveText('1 of 3');

  await page.getByRole('button', { name: 'Replace All' }).click();
  const confirm = page.getByRole('dialog', { name: 'Find and replace' });
  await expect(confirm).toContainText('(3)');
  await confirm.getByRole('button', { name: 'Replace All' }).click();
  await expect(page.getByTestId('search-status')).toHaveText('Nothing found');
  const texts = firstPage(page).locator('.editor-object[data-object-type="text"]');
  await expect(texts).toHaveText(['Second Sheet note', 'Sheet 1 - A4 portrait'], { useInnerText: false });

  // One undo takes back the whole "replace all".
  await page.locator('[data-command="edit.undo"]').first().click();
  await expect(page.getByTestId('search-status')).toHaveText('1 of 3');
  await page.locator('[data-command="edit.redo"]').first().click();
  await expect(page.getByTestId('search-status')).toHaveText('Nothing found');

  const target = join(userData, 'replaced-all.pdf');
  await saveAs(target, 'replaced-all.pdf');
  // The new wording is in the file; so is the original underneath its cover (overlay, not a native edit).
  const lines = await textOf(target, 1);
  expect(lines).toContain('Sheet 1 - A4 portrait');
  expect(lines).toContain('Second Sheet note');
  expect(lines).toContain('Page 1 - A4 portrait');
  expect(await textOf(target, 2)).toContain('Sheet 2 - Letter landscape');
  expect(errors).toEqual([]);
});
