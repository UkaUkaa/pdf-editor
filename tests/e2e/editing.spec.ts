import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { PDFDict, PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createProfile, fixture, launch, makePng, openFiles, pagePixel, removeProfile, type Session } from './helpers';

let userData: string;
let session: Session;

const command = (page: Page, id: string) => page.locator(`[data-command="${id}"]`).first();
const firstPage = (page: Page) => page.locator('.viewer__page[data-page-number="1"]');
const objectsOn = (page: Page, type: string) => firstPage(page).locator(`.editor-object[data-object-type="${type}"]`);
const field = (page: Page, label: string) => page.locator('.properties').getByLabel(label, { exact: true });

/** Waits until a numeric field of the properties panel shows the expected value (to within half a point). */
async function expectField(page: Page, label: string, expected: number): Promise<void> {
  await expect
    .poll(async () => Math.abs(Number(await field(page, label).inputValue()) - expected), { message: `${label} ≈ ${expected}` })
    .toBeLessThan(0.5);
}

/** Screen position at the given fraction of the first page. */
async function at(page: Page, fx: number, fy: number): Promise<[number, number]> {
  const box = (await firstPage(page).boundingBox())!;
  return [box.x + box.width * fx, box.y + box.height * fy];
}

async function drag(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await page.mouse.move(...(await at(page, ...from)));
  await page.mouse.down();
  await page.mouse.move(...(await at(page, ...to)), { steps: 6 });
  await page.mouse.up();
}

async function chooseShape(page: Page, name: string): Promise<void> {
  await page.locator('[data-action="shapes"]').click();
  await page.getByRole('menuitemcheckbox', { name }).click();
}

/** Text lines of a page of a saved file, read with an independent parser. */
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

test('adds text, shapes, drawings and an image, transforms them and saves real PDF content', async () => {
  const { page, app, errors } = session;
  await openFiles(session, fixture('mixed-pages.pdf'));
  await expect(firstPage(page).locator('canvas[data-status="ready"]')).toBeVisible();
  // Show the whole page, so every point of it can be reached with the mouse.
  await page.locator('.toolbar__zoom').selectOption('fitPage');
  await expect(firstPage(page)).toBeInViewport({ ratio: 1 });

  // --- Text with Russian, Ukrainian and English ------------------------------------------
  await command(page, 'insert.text').click();
  await page.mouse.click(...(await at(page, 0.45, 0.1)));
  await page.keyboard.type('Привет, мир! Привіт, їжак і ґанок.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Hello, world!');
  await page.keyboard.press('Escape');
  await expect(objectsOn(page, 'text')).toHaveCount(1);
  await expect(objectsOn(page, 'text')).toContainText('ґанок');
  // Wide enough for the first paragraph to stay on one line.
  await field(page, 'Width').fill('400');
  // The bundled font is really in use (not a system fallback).
  expect(await page.evaluate(() => document.fonts.check('16px "PDF Editor Sans"', 'їґЖ'))).toBe(true);

  // --- A filled rectangle in a clear area of the page -------------------------------------
  await chooseShape(page, 'Rectangle');
  await drag(page, [0.2, 0.6], [0.5, 0.75]);
  await expect(objectsOn(page, 'shape')).toHaveCount(1);
  await expect(page.getByTestId('selection-summary')).toHaveText('Shape');
  await page.locator('.properties').getByRole('checkbox', { name: 'Fill' }).check();
  await field(page, 'Stroke width').fill('4');

  // Geometry in the panel is in PDF points: 30 % of the 595 pt wide page.
  await expectField(page, 'Width', 595.28 * 0.3);
  await expectField(page, 'X', 595.28 * 0.2);

  // --- Move by dragging, resize by a handle, rotate by the rotate handle -------------------
  await drag(page, [0.35, 0.67], [0.45, 0.72]);
  await expectField(page, 'X', 595.28 * 0.3);
  await expectField(page, 'Y', 841.89 * 0.65);

  const handle = (await page.locator('.selection__handle[data-handle="se"]').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(...(await at(page, 0.7, 0.85)), { steps: 5 });
  await page.mouse.up();
  await expectField(page, 'Width', 595.28 * 0.4);
  await expectField(page, 'Height', 841.89 * 0.2);
  // The top-left corner stayed where it was.
  await expectField(page, 'X', 595.28 * 0.3);

  const rotate = (await page.locator('.selection__handle--rotate').boundingBox())!;
  const centre = await at(page, 0.5, 0.75);
  await page.mouse.move(rotate.x + rotate.width / 2, rotate.y + rotate.height / 2);
  await page.mouse.down();
  await page.keyboard.down('Shift');
  await page.mouse.move(centre[0] + 200, centre[1], { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expectField(page, 'Rotation', 90);
  await field(page, 'Rotation').fill('0');

  // Keyboard nudging, then undo of the whole nudge as one step.
  await page.locator('.viewer').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expectField(page, 'X', 595.28 * 0.3 + 2);
  await command(page, 'edit.undo').click();
  await expectField(page, 'X', 595.28 * 0.3);

  // The fill colour is what is on screen inside the rectangle (yellow over white paper).
  await page.mouse.click(...(await at(page, 0.9, 0.95)));
  await expect(page.locator('.selection')).toHaveCount(0);

  // --- Arrow, freehand stroke, highlighter -----------------------------------------------
  await chooseShape(page, 'Arrow');
  await drag(page, [0.75, 0.6], [0.9, 0.5]);
  await command(page, 'tools.draw').click();
  await drag(page, [0.1, 0.9], [0.3, 0.93]);
  await drag(page, [0.1, 0.95], [0.3, 0.97]);
  await command(page, 'tools.highlight').click();
  await drag(page, [0.45, 0.13], [0.8, 0.13]);
  await expect(objectsOn(page, 'path')).toHaveCount(3);
  await expect(objectsOn(page, 'shape')).toHaveCount(2);

  // The eraser removes freehand strokes only.
  await command(page, 'tools.eraser').click();
  await page.mouse.click(...(await at(page, 0.2, 0.96)));
  await expect(objectsOn(page, 'path')).toHaveCount(2);
  await page.mouse.click(...(await at(page, 0.5, 0.75)));
  await expect(objectsOn(page, 'shape')).toHaveCount(2);

  // --- Image from a file -----------------------------------------------------------------
  const png = join(userData, 'dot.png');
  await writeFile(png, makePng(2, 2, [[0, 160, 0], [0, 160, 0], [0, 160, 0], [0, 160, 0]]));
  await app.evaluate(({ dialog }, filePaths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths });
  }, [png]);
  await command(page, 'insert.image').click();
  await expect(objectsOn(page, 'image')).toHaveCount(1);
  await expect(page.getByTestId('selection-summary')).toHaveText('Image');
  await field(page, 'X').fill('300');
  await field(page, 'Y').fill('250');
  await field(page, 'Width').fill('60');
  await field(page, 'Height').fill('60');

  // --- Copy and paste; thumbnails mirror the page ------------------------------------------
  await page.locator('.viewer').focus();
  await session.app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0]!.webContents;
    contents.send('menu:command', 'edit.copy');
    contents.send('menu:command', 'edit.paste');
  });
  await expect(objectsOn(page, 'image')).toHaveCount(2);
  await command(page, 'edit.undo').click();
  await expect(objectsOn(page, 'image')).toHaveCount(1);
  await expect(page.locator('.thumbnail[data-page-number="1"] .editor-object')).toHaveCount(6);

  // --- Save and inspect the file with independent parsers -----------------------------------
  const target = join(userData, 'edited.pdf');
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, target);
  await session.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.webContents.send('menu:command', 'file.saveAs'),
  );
  await expect(page.getByRole('tab', { name: 'edited.pdf' })).toBeVisible();
  await expect(page.getByTestId('document-status')).toHaveText('No changes');

  // Text is real text: the original line plus what was typed, Cyrillic included.
  expect(await textOf(target, 1)).toEqual(['Page 1 - A4 portrait', 'Привет, мир! Привіт, їжак і ґанок.', 'Hello, world!']);
  expect(await textOf(target, 2)).toEqual(['Page 2 - Letter landscape']);
  const saved = await PDFDocument.load(await readFile(target));
  const resources = saved.getPages()[0]!.node.Resources();
  const xobjects = resources?.lookup(PDFName.of('XObject'));
  // Exactly one image (the inserted PNG): shapes and strokes are vector paths, not pictures.
  expect(xobjects instanceof PDFDict ? xobjects.keys().length : 0).toBe(1);
  // Subset font + small image + vector paths: nowhere near a rasterised page.
  expect((await readFile(target)).length).toBeLessThan(60_000);
  expect(errors).toEqual([]);

  // --- Reopen the saved file: everything is now part of the page itself ----------------------
  await session.app.close();
  session = await launch(userData);
  await session.page.locator('.recent-item', { hasText: 'edited.pdf' }).click();
  await expect(firstPage(session.page).locator('canvas[data-status="ready"]')).toBeVisible();
  await expect(firstPage(session.page).locator('.editor-object')).toHaveCount(0);
  // Yellow fill of the rectangle, green image, white paper elsewhere.
  expect(await pagePixel(session.page, 1, 0.5, 0.78)).toEqual([255, 225, 77]);
  expect(await pagePixel(session.page, 1, (300 + 30) / 595.28, (250 + 30) / 841.89)).toEqual([0, 160, 0]);
  expect(await pagePixel(session.page, 1, 0.9, 0.3)).toEqual([255, 255, 255]);
  expect(session.errors).toEqual([]);
});

test('replaces a line of original text with an overlay and says so', async () => {
  const { page, app, errors } = session;
  await openFiles(session, fixture('mixed-pages.pdf'));
  await expect(firstPage(page).locator('canvas[data-status="ready"]')).toBeVisible();

  await command(page, 'tools.editText').click();
  await expect(page.locator('.properties')).toContainText('The original is covered, not removed from the file');
  const line = firstPage(page).locator('.text-run[data-text-run="Page 1 - A4 portrait"]');
  await expect(line).toBeVisible();

  // The outline sits on the original text: 60 pt from the left edge, in the middle of the page.
  const pageBox = (await firstPage(page).boundingBox())!;
  const lineBox = (await line.boundingBox())!;
  expect((lineBox.x - pageBox.x) / pageBox.width).toBeCloseTo(58 / 595.28, 2);
  expect((lineBox.y + lineBox.height / 2 - pageBox.y) / pageBox.height).toBeCloseTo(0.49, 1);

  await line.click();
  const editor = firstPage(page).locator('.text-editor');
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue('Page 1 - A4 portrait');
  await editor.press('ControlOrMeta+a');
  await page.keyboard.type('Исправлено');
  await page.keyboard.press('Escape');

  const replacement = firstPage(page).locator('.editor-object[data-object-type="text"]');
  await expect(replacement).toHaveText('Исправлено');
  await replacement.click();
  await expect(page.locator('.properties')).toContainText('Overlay replacement');
  // Matched to the original: 28 pt text, black on the white of the page.
  await expectField(page, 'Size', 28);
  expect(await page.locator('.properties').getByLabel('Color', { exact: true }).inputValue()).toBe('#1a1a1a');
  expect(await page.locator('.properties input[type="color"]').last().inputValue()).toBe('#ffffff');

  const target = join(userData, 'replaced.pdf');
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, target);
  await session.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.webContents.send('menu:command', 'file.saveAs'),
  );
  await expect(page.getByRole('tab', { name: 'replaced.pdf' })).toBeVisible();

  // Honest about what an overlay is: the new text is in the file, and so is the original underneath.
  expect(await textOf(target, 1)).toEqual(['Page 1 - A4 portrait', 'Исправлено']);
  expect(errors).toEqual([]);

  // What a reader sees: the original glyphs are covered.
  await session.app.close();
  session = await launch(userData);
  await session.page.locator('.recent-item', { hasText: 'replaced.pdf' }).click();
  await expect(firstPage(session.page).locator('canvas[data-status="ready"]')).toBeVisible();
  // The new text is shorter than the original line, which ended near x = 332 pt.
  // Where "…portrait" used to be there is now nothing but the cover.
  const dark = await session.page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.viewer__page[data-page-number="1"] canvas')!;
    const context = canvas.getContext('2d')!;
    const scale = canvas.width / 595.28;
    const data = context.getImageData(Math.round(262 * scale), Math.round(395 * scale), Math.round(70 * scale), Math.round(34 * scale)).data;
    let count = 0;
    for (let index = 0; index < data.length; index += 4) if (data[index]! < 128 && data[index + 3]! > 128) count += 1;
    return count;
  });
  expect(dark).toBe(0);
  expect(session.errors).toEqual([]);
});
