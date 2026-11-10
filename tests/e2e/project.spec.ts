import { copyFile, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createProfile, fixture, launch, makePng, openFiles, removeProfile, type Session } from './helpers';

let userData: string;
let session: Session;

const command = (page: Page, id: string) => page.locator(`[data-command="${id}"]`).first();
const firstPage = (page: Page) => page.locator('.viewer__page[data-page-number="1"]');
const stack = (page: Page) => page.locator('.layers .layer:not(.layer--fixed) .layer__name');
const status = (page: Page) => page.getByTestId('document-status');
const shape = (page: Page) => firstPage(page).locator('.editor-object[data-object-type="shape"]').first();

/** Where the rectangle is, as fractions of the page (independent of window size and zoom). */
async function shapePlace(page: Page): Promise<number[]> {
  const box = (await shape(page).boundingBox())!;
  const sheet = (await firstPage(page).boundingBox())!;
  return [(box.x - sheet.x) / sheet.width, (box.y - sheet.y) / sheet.height, box.width / sheet.width, box.height / sheet.height].map(
    (value) => Math.round(value * 100) / 100,
  );
}

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

const menuCommand = (id: string): Promise<void> =>
  session.app.evaluate(({ BrowserWindow }, commandId) => BrowserWindow.getAllWindows()[0]!.webContents.send('menu:command', commandId), id);

const stubSaveDialog = (target: string): Promise<void> =>
  session.app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, target);

async function openFitted(path: string): Promise<void> {
  const { page } = session;
  await openFiles(session, path);
  await expect(firstPage(page).locator('canvas[data-status="ready"]')).toBeVisible();
  await page.locator('.toolbar__zoom').selectOption('fitPage');
  await expect(firstPage(page)).toBeInViewport({ ratio: 1 });
}

async function quit(): Promise<void> {
  await session.app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 0;
  });
  await session.app.close().catch(() => undefined);
}

const recoveryFiles = async (): Promise<string[]> => (await readdir(join(userData, 'recovery')).catch(() => [])).sort();

test.afterEach(async () => {
  await quit();
  await removeProfile(userData);
});

test('saves a project and reopens it after a restart with everything still editable', async () => {
  userData = await createProfile({ language: 'en', theme: 'light', autosaveInterval: 0 });
  session = await launch(userData);
  const { page } = session;
  await openFitted(fixture('mixed-pages.pdf'));
  await page.getByRole('tab', { name: 'Layers' }).click();

  // A filled rectangle, a line of text and an image: three objects on three layers.
  await drawRectangle(page, [0.2, 0.6], [0.5, 0.75]);
  await command(page, 'insert.text').click();
  await page.mouse.click(...(await at(page, 0.5, 0.15)));
  await page.keyboard.type('Проект text');
  await page.keyboard.press('Escape');
  const png = join(userData, 'dot.png');
  await writeFile(png, makePng(2, 2, [[0, 160, 0], [0, 160, 0], [0, 160, 0], [0, 160, 0]]));
  await session.app.evaluate(({ dialog }, filePaths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths });
  }, [png]);
  await command(page, 'insert.image').click();
  await expect(firstPage(page).locator('.editor-object')).toHaveCount(3);
  const layersBefore = await stack(page).allTextContents();
  expect(layersBefore).toHaveLength(3);
  const place = await shapePlace(page);
  expect(place[0]).toBeCloseTo(0.2, 1);
  expect(place[1]).toBeCloseTo(0.6, 1);

  const target = join(userData, 'work.pdfproject');
  await stubSaveDialog(target);
  await menuCommand('file.saveProject');
  await expect(page.getByRole('tab', { name: 'work.pdfproject' })).toBeVisible();
  await expect(status(page)).toHaveText('No changes');

  // The file is a ZIP holding the untouched original PDF, the image and the model.
  const entries = unzipSync(new Uint8Array(await readFile(target)));
  const names = Object.keys(entries);
  const sourceName = names.find((name) => name.startsWith('sources/'))!;
  expect(Buffer.from(entries[sourceName]!).equals(await readFile(fixture('mixed-pages.pdf')))).toBe(true);
  expect(names.filter((name) => name.startsWith('assets/'))).toHaveLength(1);
  expect(JSON.parse(Buffer.from(entries['manifest.json']!).toString())).toMatchObject({ format: 'pdfproject', version: 1, name: 'work.pdfproject' });
  expect(await recoveryFiles()).toEqual([]);

  // --- Restart and open the project ---------------------------------------------------------
  await quit();
  session = await launch(userData);
  const reopened = session.page;
  // The project is in the list of recent files.
  await expect(reopened.locator('.welcome')).toContainText('work.pdfproject');
  await openFitted(target);
  await expect(reopened.getByRole('tab', { name: 'work.pdfproject' })).toBeVisible();
  await expect(status(reopened)).toHaveText('No changes');
  await expect(firstPage(reopened).locator('.editor-object')).toHaveCount(3);
  await reopened.getByRole('tab', { name: 'Layers' }).click();
  expect(await stack(reopened).allTextContents()).toEqual(layersBefore);
  expect(await shapePlace(reopened)).toEqual(place);
  await expect(shape(reopened).locator('[fill]:not([fill="none"]):not([fill="transparent"])').first()).toBeAttached();

  // Objects are still objects: the rectangle can be picked up and moved, and that can be undone.
  await command(reopened, 'tools.select').click();
  await drag(reopened, [0.35, 0.68], [0.35, 0.4]);
  await expect(status(reopened)).toHaveText('Unsaved changes');
  expect((await shapePlace(reopened))[1]).toBeCloseTo(place[1]! - 0.28, 1);
  await menuCommand('edit.undo');
  await expect(status(reopened)).toHaveText('No changes');
  expect(await shapePlace(reopened)).toEqual(place);

  // The text is editable text, not pixels.
  await firstPage(reopened).locator('.editor-object[data-object-type="text"]').dblclick();
  await expect(reopened.locator('textarea.text-editor')).toBeFocused();
  await reopened.keyboard.press('End');
  await reopened.keyboard.type('!');
  await reopened.keyboard.press('Escape');

  // Save in place (still a project), then export a standard PDF from it.
  await menuCommand('file.save');
  await expect(status(reopened)).toHaveText('No changes');
  expect([...(await readFile(target)).subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);

  const exported = join(userData, 'work.pdf');
  await stubSaveDialog(exported);
  await menuCommand('file.exportPdf');
  await expect
    .poll(async () => (await readFile(exported).catch(() => Buffer.alloc(0))).subarray(0, 5).toString())
    .toBe('%PDF-');
  await expect(reopened.getByRole('tab', { name: 'work.pdfproject' })).toBeVisible();
  const pdf = await getDocument({
    data: new Uint8Array(await readFile(exported)),
    disableFontFace: true,
    standardFontDataUrl: `${resolve('node_modules/pdfjs-dist/standard_fonts')}/`,
  }).promise;
  const content = await (await pdf.getPage(1)).getTextContent();
  const strings = content.items.map((item) => ('str' in item ? item.str : '')).filter((text) => text.trim() !== '');
  expect(strings).toContain('Проект text!');
  expect(session.errors).toEqual([]);
});

test('rejects a damaged project file with a clear message', async () => {
  userData = await createProfile({ language: 'en', theme: 'light', autosaveInterval: 0 });
  session = await launch(userData);
  const { page } = session;
  const broken = join(userData, 'broken.pdfproject');
  await writeFile(broken, Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('this is not really an archive')]));
  const disguised = join(userData, 'disguised.pdfproject');
  await copyFile(fixture('mixed-pages.pdf'), disguised);
  await openFiles(session, broken, disguised);
  const notice = page.getByRole('dialog', { name: 'Some files could not be opened' });
  await expect(notice).toContainText('broken.pdfproject: the file is not a PDF Editor project');
  await expect(notice).toContainText('disguised.pdfproject: not a PDF or project file');
  await notice.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('.welcome')).toBeVisible();
  await expect(page.getByRole('tab', { name: /pdfproject/ })).toHaveCount(0);
});

test('recovers unsaved work after a crash and cleans up after a normal exit', async () => {
  userData = await createProfile({ language: 'en', theme: 'light', autosaveInterval: 1 });
  const original = join(userData, 'report.pdf');
  await copyFile(fixture('mixed-pages.pdf'), original);
  const originalBytes = await readFile(original);

  session = await launch(userData);
  await openFitted(original);
  await drawRectangle(session.page, [0.2, 0.6], [0.5, 0.75]);
  await expect(status(session.page)).toHaveText('Unsaved changes');
  const place = await shapePlace(session.page);

  // Autosave writes a recovery copy; the user's file is not touched.
  await expect.poll(recoveryFiles).toHaveLength(2);
  const [meta] = await recoveryFiles();
  expect(JSON.parse(await readFile(join(userData, 'recovery', meta!), 'utf8'))).toMatchObject({ name: 'report.pdf', path: original });
  expect((await readFile(original)).equals(originalBytes)).toBe(true);

  // --- Crash ----------------------------------------------------------------------------------
  session.app.process().kill('SIGKILL');
  await new Promise((resolveExit) => session.app.process().once('exit', resolveExit));
  expect(await recoveryFiles()).toHaveLength(2);

  session = await launch(userData);
  const { page } = session;
  const dialog = page.getByRole('dialog', { name: 'Recover unsaved documents' });
  await expect(dialog).toContainText('report.pdf');
  await dialog.getByRole('button', { name: 'Restore: report.pdf' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('tab', { name: /report\.pdf/ })).toBeVisible();
  await expect(status(page)).toHaveText('Unsaved changes');
  await page.locator('.toolbar__zoom').selectOption('fitPage');
  await expect(firstPage(page).locator('canvas[data-status="ready"]')).toBeVisible();
  await expect(firstPage(page).locator('.editor-object')).toHaveCount(1);
  expect(await shapePlace(page)).toEqual(place);

  // The restored document has a copy of its own; the old one is gone.
  await expect.poll(recoveryFiles).toHaveLength(2);
  expect(await recoveryFiles()).not.toContain(meta);

  // Saving writes to the original file and removes the copy.
  await menuCommand('file.save');
  await expect(status(page)).toHaveText('No changes');
  await expect.poll(recoveryFiles).toEqual([]);
  expect((await readFile(original)).equals(originalBytes)).toBe(false);

  // --- Normal exit with discarded changes leaves nothing behind -------------------------------
  await drawRectangle(page, [0.6, 0.2], [0.8, 0.3]);
  await expect.poll(recoveryFiles).toHaveLength(2);
  await quit();
  await expect.poll(recoveryFiles).toEqual([]);

  session = await launch(userData);
  await expect(session.page.locator('.welcome')).toBeVisible();
  await expect(session.page.getByRole('dialog', { name: 'Recover unsaved documents' })).toHaveCount(0);
  expect(session.errors).toEqual([]);
});
