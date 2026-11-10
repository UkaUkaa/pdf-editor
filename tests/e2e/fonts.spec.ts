import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDict, PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { expect, test, type Page } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createProfile, fixture, launch, openFiles, removeProfile, type Session } from './helpers';

let userData: string;
let session: Session;

const firstPage = (page: Page) => page.locator('.viewer__page[data-page-number="1"]');
const textObject = (page: Page) => firstPage(page).locator('.editor-object[data-object-type="text"]');
const fontField = (page: Page) => page.locator('.properties').getByLabel('Font', { exact: true });
const menuCommand = (id: string): Promise<void> =>
  session.app.evaluate(({ BrowserWindow }, commandId) => BrowserWindow.getAllWindows()[0]!.webContents.send('menu:command', commandId), id);
const stubSaveDialog = (target: string): Promise<void> =>
  session.app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, target);

/** Names of the fonts embedded in a saved file, without subset tags. */
async function embeddedFonts(path: string): Promise<string[]> {
  const parsed = await PDFDocument.load(await readFile(path), { updateMetadata: false });
  const names = new Set<string>();
  for (const [, object] of parsed.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict) || object.get(PDFName.of('Type')) !== PDFName.of('Font')) continue;
    const base = object.get(PDFName.of('BaseFont'));
    if (base instanceof PDFName) names.add(base.decodeText().replace(/^[A-Z]{6}\+/, '').replace(/-\d+$/, ''));
  }
  return [...names].sort();
}

async function textOf(path: string): Promise<string> {
  const document = await getDocument({ data: new Uint8Array(await readFile(path)), disableFontFace: true }).promise;
  const content = await (await document.getPage(1)).getTextContent();
  const text = content.items.flatMap((item) => ('str' in item && item.str.trim() ? [item.str] : [])).join(' ');
  await document.loadingTask.destroy();
  return text;
}

const textWidth = (page: Page): Promise<number> =>
  textObject(page).locator('text').evaluate((element) => (element as SVGTextElement).getComputedTextLength());

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

// Times New Roman comes with macOS and Windows; other systems may not have it.
test.skip(process.platform !== 'darwin' && process.platform !== 'win32', 'needs the fonts shipped with macOS or Windows');

test('sets text in Times New Roman from the system and embeds that font in the PDF', async () => {
  const { page } = session;
  await openFiles(session, fixture('mixed-pages.pdf'));
  await expect(firstPage(page).locator('canvas[data-status="ready"]')).toBeVisible();
  await page.locator('.toolbar__zoom').selectOption('fitPage');
  await expect(firstPage(page)).toBeInViewport({ ratio: 1 });

  await page.locator('[data-command="insert.text"]').first().click();
  const box = (await firstPage(page).boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.3);
  await page.keyboard.type('Договір № 15 — Agreement');
  await page.keyboard.press('Escape');
  await expect(textObject(page)).toHaveCount(1);
  const widthInDejaVu = await textWidth(page);

  // The list offers the fonts of this computer, Times New Roman first among the popular ones.
  const popular = fontField(page).locator('optgroup[label="Popular"] option');
  await expect(popular.first()).toHaveText('Times New Roman');
  expect(await fontField(page).locator('option').count()).toBeGreaterThan(20);
  await fontField(page).selectOption('Times New Roman');

  // The browser draws with the real font file, registered under the application's own name.
  await expect(textObject(page).locator('text')).toHaveAttribute('font-family', /PDF Editor · Times New Roman/);
  await expect.poll(() => page.evaluate(() => document.fonts.check('16px "PDF Editor · Times New Roman"'))).toBe(true);
  expect(await page.evaluate(() => [...document.fonts].filter((face) => face.family.includes('Times New Roman')).length)).toBe(4);
  // Times is narrower than DejaVu Sans, so the same words take less room.
  await expect.poll(() => textWidth(page)).toBeLessThan(widthInDejaVu * 0.9);

  const regular = join(userData, 'times.pdf');
  await stubSaveDialog(regular);
  await menuCommand('file.saveAs');
  await expect(page.getByRole('tab', { name: 'times.pdf' })).toBeVisible();
  expect(await embeddedFonts(regular)).toContain('TimesNewRomanPSMT');
  expect(await textOf(regular)).toContain('Договір № 15 — Agreement');

  // Bold italic uses the family's own bold italic face.
  await textObject(page).click();
  await page.locator('.properties').getByRole('button', { name: 'Bold' }).click();
  await page.locator('.properties').getByRole('button', { name: 'Italic' }).click();
  await menuCommand('file.save');
  await expect(page.getByTestId('document-status')).toHaveText('No changes');
  expect(await embeddedFonts(regular)).toContain('TimesNewRomanPS-BoldItalicMT');
  expect(await embeddedFonts(regular)).not.toContain('TimesNewRomanPSMT');

  // A project keeps the font by name; after reopening it is loaded again.
  const project = join(userData, 'times.pdfproject');
  await stubSaveDialog(project);
  await menuCommand('file.saveProject');
  await expect(page.getByRole('tab', { name: 'times.pdfproject' })).toBeVisible();
  await menuCommand('file.close');
  await expect(page.getByRole('tab', { name: 'times.pdfproject' })).toHaveCount(0);
  await openFiles(session, project);
  await expect(textObject(page)).toHaveCount(1);
  await expect(textObject(page).locator('text')).toHaveAttribute('font-weight', '700');
  await expect(textObject(page).locator('text')).toHaveAttribute('font-family', /PDF Editor · Times New Roman/);
  await expect.poll(() => page.evaluate(() => document.fonts.check('bold italic 16px "PDF Editor · Times New Roman"'))).toBe(true);
  await page.locator('[data-command="tools.select"]').first().click();
  await textObject(page).click();
  await expect(fontField(page)).toHaveValue('Times New Roman');
  expect(session.errors).toEqual([]);
});
