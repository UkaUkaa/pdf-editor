import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createProfile, fixture, launch, openFiles, removeProfile, type Session } from './helpers';

let userData: string;
let session: Session;

const pageStatus = (page: Page) => page.getByTestId('status-page');
const menuCommand = (id: string): Promise<void> =>
  session.app.evaluate(({ BrowserWindow }, commandId) => {
    BrowserWindow.getAllWindows()[0]!.webContents.send('menu:command', commandId);
  }, id);

async function saveAs(target: string, tabName: string): Promise<void> {
  await session.app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, target);
  await menuCommand('file.saveAs');
  await expect(session.page.getByRole('tab', { name: tabName })).toBeVisible();
}

const load = async (path: string) =>
  getDocument({
    data: new Uint8Array(await readFile(path)),
    disableFontFace: true,
    standardFontDataUrl: `${resolve('node_modules/pdfjs-dist/standard_fonts')}/`,
  }).promise;

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

test('searches a real document and highlights the matches', async () => {
  const { page, errors } = session;
  await openFiles(session, fixture('many-pages.pdf'));
  await expect(pageStatus(page)).toContainText('1 / 60');

  await menuCommand('edit.find');
  const input = page.getByRole('searchbox', { name: 'Search in document' });
  await expect(input).toBeFocused();

  // Every page shows its number: "4" occurs on 4, 14, 24, 34, 40–49 (twice on 44) and 54.
  await input.fill('4');
  await expect(page.getByTestId('search-status')).toHaveText('1 of 16');
  await page.getByRole('checkbox', { name: 'Whole words' }).check();
  await expect(page.getByTestId('search-status')).toHaveText('1 of 1');
  await expect(pageStatus(page)).toContainText('1 / 60');
  await input.press('Enter');
  await expect(pageStatus(page)).toContainText('4 / 60');

  // The highlight lies on the digit: in the middle of the page, about 120 pt tall.
  const hit = page.locator('.viewer__page[data-page-number="4"] .search-hit[data-active]');
  await expect(hit).toBeVisible();
  const pageBox = (await page.locator('.viewer__page[data-page-number="4"]').boundingBox())!;
  const hitBox = (await hit.boundingBox())!;
  expect((hitBox.x - pageBox.x) / pageBox.width).toBeCloseTo(240 / 595.28, 1);
  expect((hitBox.y + hitBox.height / 2 - pageBox.y) / pageBox.height).toBeGreaterThan(0.4);
  expect((hitBox.y + hitBox.height / 2 - pageBox.y) / pageBox.height).toBeLessThan(0.6);

  // A two-digit query, then stepping through results with the result list.
  await page.getByRole('checkbox', { name: 'Whole words' }).uncheck();
  await expect(page.getByTestId('search-status')).toHaveText('1 of 16');
  await input.fill('59');
  await expect(page.locator('.search-result')).toHaveText(['Page 5959']);
  await page.locator('.search-result').first().click();
  await expect(pageStatus(page)).toContainText('59 / 60');
  await input.fill('no such text');
  await expect(page.getByTestId('search-status')).toHaveText('Nothing found');
  await expect(page.locator('.search-hit')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('keeps bookmarks, a watermark and page numbers in the saved PDF', async () => {
  const { page, errors } = session;
  await openFiles(session, fixture('mixed-pages.pdf'));
  await expect(pageStatus(page)).toContainText('1 / 3');
  await page.getByRole('tab', { name: 'Bookmarks' }).click();
  await expect(page.locator('.bookmarks')).toContainText('This document has no bookmarks');

  // Two bookmarks; the second one nested under the first.
  await page.locator('[data-command="insert.bookmark"]').click();
  await page.keyboard.type('Введение');
  await page.keyboard.press('Enter');
  await page.locator('.toolbar__page-input').fill('3');
  await page.locator('.toolbar__page-input').press('Enter');
  await page.locator('[data-command="insert.bookmark"]').click();
  await page.keyboard.type('Rotated page');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Nest under the bookmark above' }).click();
  await expect(page.getByRole('treeitem', { name: /Rotated page/ })).toHaveAttribute('aria-level', '2');

  // Watermark on all pages and page numbers in the footer.
  await menuCommand('insert.watermark');
  const watermark = page.getByRole('dialog', { name: 'Watermark' });
  await watermark.getByLabel('Text').fill('DRAFT');
  await watermark.getByRole('button', { name: 'Add' }).click();
  await menuCommand('insert.headerFooter');
  const footer = page.getByRole('dialog', { name: 'Header and footer' });
  await footer.getByLabel('Footer').fill('Стр. {page} из {pages}');
  await footer.getByRole('button', { name: 'Add' }).click();
  await expect(page.locator('.viewer__page[data-page-number="3"] .editor-object[data-object-type="text"]')).toHaveCount(2);
  // Thumbnails show the stamps on every page.
  await page.getByRole('tab', { name: 'Pages', exact: true }).click();
  await expect(page.locator('.thumbnail .editor-object')).toHaveCount(6);

  const target = join(userData, 'stamped.pdf');
  await saveAs(target, 'stamped.pdf');

  // --- The file, read with an independent parser -------------------------------------------
  const saved = await load(target);
  const outline = (await saved.getOutline())!;
  expect(outline.map((item) => item.title)).toEqual(['Введение']);
  expect(outline[0]!.items.map((item) => item.title)).toEqual(['Rotated page']);
  expect(await saved.getPageIndex((outline[0]!.dest as unknown[])[0] as never)).toBe(0);
  expect(await saved.getPageIndex((outline[0]!.items[0]!.dest as unknown[])[0] as never)).toBe(2);
  for (const number of [1, 2, 3]) {
    const content = await (await saved.getPage(number)).getTextContent();
    const lines = content.items.flatMap((item) => ('str' in item && item.str.trim() ? [item.str] : []));
    expect(lines).toContain('DRAFT');
    expect(lines).toContain(`Стр. ${number} из 3`);
  }
  const config = await saved.getOptionalContentConfig();
  expect([...config].map(([, group]) => (group as { name: string }).name)).toContain('Watermark (page 2)');
  await saved.loadingTask.destroy();
  expect(errors).toEqual([]);

  // --- Reopened: the bookmarks come back from the file and still navigate --------------------
  await session.app.close();
  session = await launch(userData);
  await session.page.locator('.recent-item', { hasText: 'stamped.pdf' }).click();
  await expect(pageStatus(session.page)).toContainText('1 / 3');
  await session.page.getByRole('tab', { name: 'Bookmarks' }).click();
  await expect(session.page.getByRole('treeitem')).toHaveCount(2);
  await session.page.getByRole('treeitem', { name: /Rotated page/ }).getByRole('button', { name: 'Rotated page' }).click();
  await expect(pageStatus(session.page)).toContainText('3 / 3');
  // An untouched reopened document is not "modified" just because it has bookmarks.
  await expect(session.page.getByTestId('document-status')).toHaveText('No changes');

  // The stamps are now part of the pages and are found by the search on every page,
  // including the rotated page and the slanted watermark.
  await session.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.send('menu:command', 'edit.find'));
  await session.page.getByRole('searchbox', { name: 'Search in document' }).fill('стр. ');
  await expect(session.page.getByTestId('search-status')).toHaveText('1 of 3');
  await session.page.getByRole('searchbox', { name: 'Search in document' }).fill('draft');
  await expect(session.page.getByTestId('search-status')).toHaveText('1 of 3');
  expect(session.errors).toEqual([]);
});
