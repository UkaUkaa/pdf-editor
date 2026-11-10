import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createProfile, fixture, launch, openFiles, pagePixel, removeProfile, type Session } from './helpers';

let userData: string;
let session: Session;

const command = (page: Page, id: string) => page.locator(`[data-command="${id}"]`).first();
const firstPage = (page: Page) => page.locator('.viewer__page[data-page-number="1"]');
const layerRow = (page: Page, name: string) => page.locator('.layers .layer', { has: page.locator('.layer__name', { hasText: new RegExp(`^${name}$`) }) });
const stack = (page: Page) => page.locator('.layers .layer:not(.layer--fixed) .layer__name');

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

async function drawRectangle(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await page.locator('[data-action="shapes"]').click();
  await page.getByRole('menuitemcheckbox', { name: 'Rectangle' }).click();
  await drag(page, from, to);
  await page.locator('.properties').getByRole('checkbox', { name: 'Fill' }).check();
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

test('organises objects in layers and saves them as PDF layers', async () => {
  const { page, app, errors } = session;
  await openFiles(session, fixture('mixed-pages.pdf'));
  await expect(firstPage(page).locator('canvas[data-status="ready"]')).toBeVisible();
  await page.locator('.toolbar__zoom').selectOption('fitPage');
  await expect(firstPage(page)).toBeInViewport({ ratio: 1 });
  await page.getByRole('tab', { name: 'Layers' }).click();
  await expect(page.locator('.layers')).toContainText('Original page content');

  // Objects go to layers of their type, created on demand.
  await drawRectangle(page, [0.2, 0.6], [0.5, 0.75]);
  await command(page, 'insert.text').click();
  await page.mouse.click(...(await at(page, 0.5, 0.15)));
  await page.keyboard.type('Layer text');
  await page.keyboard.press('Escape');
  await expect(stack(page)).toHaveText(['Text', 'Shapes']);

  // A layer of my own, renamed, with a second rectangle on it.
  await command(page, 'layers.new').click();
  await layerRow(page, 'Layer').locator('.layer__name').dblclick();
  await page.keyboard.type('Черновик');
  await page.keyboard.press('Enter');
  await expect(stack(page)).toHaveText(['Черновик', 'Text', 'Shapes']);
  await drawRectangle(page, [0.6, 0.6], [0.85, 0.75]);
  await expect(layerRow(page, 'Черновик').locator('.layer__count')).toHaveText('1');
  await expect(firstPage(page).locator('.editor-object')).toHaveCount(3);

  // Reorder by dragging: put the draft layer at the bottom of the stack.
  await layerRow(page, 'Черновик').locator('.layer__row').dragTo(layerRow(page, 'Shapes').locator('.layer__row'), {
    targetPosition: { x: 80, y: 26 },
  });
  await expect(stack(page)).toHaveText(['Text', 'Shapes', 'Черновик']);
  const paintedTypes = () =>
    firstPage(page)
      .locator('.editor-object')
      .evaluateAll((elements) => elements.map((element) => (element as HTMLElement).dataset['objectType']));
  expect(await paintedTypes()).toEqual(['shape', 'shape', 'text']);

  // Lock the shapes layer: clicking its rectangle no longer selects it.
  await layerRow(page, 'Shapes').getByRole('button', { name: 'Layer locked' }).click();
  await command(page, 'tools.select').click();
  await page.mouse.click(...(await at(page, 0.35, 0.67)));
  await expect(page.locator('.selection')).toHaveCount(0);
  // The rectangle on the unlocked draft layer still can be selected.
  await page.mouse.click(...(await at(page, 0.72, 0.67)));
  await expect(page.locator('.selection')).toHaveCount(1);
  await expect(page.locator('.properties').getByLabel('Layer', { exact: true }).locator('option:checked')).toHaveText('Черновик');

  // Hide the draft layer: its object disappears from the page and the thumbnail.
  await layerRow(page, 'Черновик').getByRole('button', { name: 'Layer visible' }).click();
  await expect(firstPage(page).locator('.editor-object')).toHaveCount(2);
  await expect(page.locator('.selection')).toHaveCount(0);

  // Undo and redo cover layer changes too.
  await command(page, 'edit.undo').click();
  await expect(firstPage(page).locator('.editor-object')).toHaveCount(3);
  await command(page, 'edit.redo').click();
  await expect(firstPage(page).locator('.editor-object')).toHaveCount(2);

  // --- Save: layers become optional content groups -----------------------------------------
  const target = join(userData, 'layered.pdf');
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, target);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.send('menu:command', 'file.saveAs'));
  await expect(page.getByRole('tab', { name: 'layered.pdf' })).toBeVisible();

  const saved = await getDocument({
    data: new Uint8Array(await readFile(target)),
    disableFontFace: true,
    standardFontDataUrl: `${resolve('node_modules/pdfjs-dist/standard_fonts')}/`,
  }).promise;
  const config = await saved.getOptionalContentConfig();
  const groups = Object.fromEntries(
    [...config].map(([id, group]) => [(group as { name: string }).name, config.isVisible({ type: 'OCG', id })]),
  );
  expect(groups).toEqual({ Черновик: false, Shapes: true, Text: true });
  await saved.loadingTask.destroy();
  expect(errors).toEqual([]);

  // --- What a reader shows: the hidden layer stays hidden, the others are painted ------------
  await session.app.close();
  session = await launch(userData);
  await session.page.locator('.recent-item', { hasText: 'layered.pdf' }).click();
  await expect(firstPage(session.page).locator('canvas[data-status="ready"]')).toBeVisible();
  // Visible shapes layer: yellow fill. Hidden draft layer: plain paper where its rectangle was.
  expect(await pagePixel(session.page, 1, 0.35, 0.67)).toEqual([255, 225, 77]);
  expect(await pagePixel(session.page, 1, 0.72, 0.67)).toEqual([255, 255, 255]);
  expect(session.errors).toEqual([]);
});
