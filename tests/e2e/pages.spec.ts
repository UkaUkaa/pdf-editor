import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from '@cantoo/pdf-lib';
import { createProfile, fixture, launch, makePng, openFiles, pagePixel, removeProfile, type Session } from './helpers';

const RED = [219, 38, 38];
const GREEN = [26, 153, 51];
const BLUE = [38, 76, 217];
const WHITE = [255, 255, 255];

let userData: string;
let work: string;
let session: Session;

const ready = (page: Page, number: number) =>
  page.locator(`.viewer__page[data-page-number="${number}"] canvas[data-status="ready"]`);
const command = (page: Page, id: string) => page.locator(`[data-command="${id}"]`).first();
const thumbnail = (page: Page, number: number) => page.locator(`.thumbnail[data-page-number="${number}"]`);
const pageStatus = (page: Page) => page.getByTestId('status-page');
const sha = async (path: string): Promise<string> => createHash('sha256').update(await readFile(path)).digest('hex');

/** Sends a command exactly as the native menu does. */
const menuCommand = (id: string): Promise<void> =>
  session.app.evaluate(({ BrowserWindow }, commandId) => {
    BrowserWindow.getAllWindows()[0]!.webContents.send('menu:command', commandId);
  }, id);

const stubSaveDialog = (path: string | null): Promise<void> =>
  session.app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => (filePath ? { canceled: false, filePath } : { canceled: true, filePath: '' });
  }, path);

async function goTo(page: Page, number: number): Promise<void> {
  await page.locator('.toolbar__page-input').fill(String(number));
  await page.locator('.toolbar__page-input').press('Enter');
  await expect(ready(page, number)).toBeVisible();
}

/** Colour of the top-left and top-right corners of a page in the main view. */
async function corners(page: Page, number: number): Promise<{ left: number[]; right: number[] }> {
  await goTo(page, number);
  return { left: await pagePixel(page, number, 0.06, 0.06), right: await pagePixel(page, number, 0.94, 0.06) };
}

const describeFile = async (path: string) =>
  (await PDFDocument.load(await readFile(path))).getPages().map((p) => ({
    width: Math.round(p.getWidth()),
    height: Math.round(p.getHeight()),
    rotation: p.getRotation().angle,
  }));

test.beforeEach(async () => {
  userData = await createProfile({ language: 'en', theme: 'light' });
  work = join(userData, 'work');
  await mkdir(work);
  session = await launch(userData);
});

test.afterEach(async () => {
  await session.app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 0; // never block teardown on the unsaved-changes prompt
  });
  await session.app.close().catch(() => undefined);
  await removeProfile(userData);
});

test('edits pages of a real PDF, saves it and reopens the result', async () => {
  const { page, errors } = session;
  const original = fixture('mixed-pages.pdf');
  const originalHash = await sha(original);
  await openFiles(session, original);
  await expect(ready(page, 1)).toBeVisible();

  // Rotate page 1 clockwise: the red block moves from the top-left to the top-right corner.
  expect(await corners(page, 1)).toEqual({ left: RED, right: WHITE });
  await command(page, 'pages.rotateCw').click();
  await expect.poll(async () => (await corners(page, 1)).right).toEqual(RED);
  expect((await corners(page, 1)).left).toEqual(WHITE);
  await expect(page.getByTestId('document-status')).toHaveText('Unsaved changes');
  await expect(page.getByTestId('status-size')).toContainText('297 × 210 mm');

  // Undo and redo with the real keyboard shortcuts' command path.
  await command(page, 'edit.undo').click();
  await expect.poll(async () => (await corners(page, 1)).left).toEqual(RED);
  await expect(page.getByTestId('document-status')).toHaveText('No changes');
  await command(page, 'edit.redo').click();
  await expect.poll(async () => (await corners(page, 1)).right).toEqual(RED);

  // Drag the first thumbnail below the last one: order becomes green, blue, red.
  const list = page.locator('.thumbnails');
  const listBox = (await list.boundingBox())!;
  const lastBox = (await thumbnail(page, 3).boundingBox())!;
  await thumbnail(page, 1).dragTo(list, {
    targetPosition: { x: listBox.width / 2, y: lastBox.y + lastBox.height + 8 - listBox.y },
  });
  await expect(pageStatus(page)).toContainText('3 / 3');
  expect((await corners(page, 1)).left).toEqual(GREEN);
  expect((await corners(page, 3)).right).toEqual(RED);

  // Duplicate the blue page (now page 2), add a blank page after the copy.
  await thumbnail(page, 2).click();
  await menuCommand('pages.duplicate');
  await expect(pageStatus(page)).toContainText('3 / 4');
  expect((await corners(page, 3)).right).toEqual(BLUE);
  await command(page, 'pages.addBlank').click();
  await expect(pageStatus(page)).toContainText('4 / 5');
  expect(await corners(page, 4)).toEqual({ left: WHITE, right: WHITE });

  // Delete the first page (green), with confirmation.
  await thumbnail(page, 1).click();
  await command(page, 'pages.delete').click();
  await page.getByRole('dialog', { name: 'Delete pages' }).getByRole('button', { name: 'Delete' }).click();
  await expect(pageStatus(page)).toContainText('/ 4');

  // Save As: the result is a valid PDF with exactly the edited structure.
  const target = join(work, 'edited.pdf');
  await stubSaveDialog(target);
  await menuCommand('file.saveAs');
  await expect(page.getByRole('tab', { name: 'edited.pdf' })).toBeVisible();
  await expect(page.getByTestId('document-status')).toHaveText('No changes');
  expect(await describeFile(target)).toEqual([
    { width: 595, height: 842, rotation: 90 }, // blue, as in the source
    { width: 595, height: 842, rotation: 90 }, // its duplicate
    { width: 842, height: 595, rotation: 0 }, // blank page sized like the rotated page before it
    { width: 595, height: 842, rotation: 90 }, // red, rotated by the user
  ]);
  // Text and vector content were copied, not rasterised: the file stays tiny.
  expect((await readFile(target)).length).toBeLessThan(6_000);
  // The source file is never touched, and no temporary files are left behind.
  expect(await sha(original)).toBe(originalHash);
  expect(await readdir(work)).toEqual(['edited.pdf']);

  // Reopen the saved file in a fresh session and check what a reader would see.
  expect(errors).toEqual([]);
  await session.app.close();
  session = await launch(userData);
  await session.page.locator('.recent-item', { hasText: 'edited.pdf' }).click();
  await expect(ready(session.page, 1)).toBeVisible();
  await expect(pageStatus(session.page)).toContainText('1 / 4');
  expect((await corners(session.page, 1)).right).toEqual(BLUE);
  expect((await corners(session.page, 2)).right).toEqual(BLUE);
  expect(await corners(session.page, 3)).toEqual({ left: WHITE, right: WHITE });
  expect((await corners(session.page, 4)).right).toEqual(RED);
  expect(session.errors).toEqual([]);
});

test('saves over the opened file safely and guards unsaved changes', async () => {
  const { page, app, errors } = session;
  const path = join(work, 'document.pdf');
  await copyFile(fixture('mixed-pages.pdf'), path);
  const before = await sha(path);
  await openFiles(session, path);
  await expect(ready(page, 1)).toBeVisible();

  // Nothing to save yet.
  await expect(command(page, 'file.save')).toHaveAttribute('aria-disabled', 'true');
  await menuCommand('pages.reverse');
  await expect(command(page, 'file.save')).toHaveAttribute('aria-disabled', 'false');

  // Closing the window with unsaved changes asks first; "Cancel" keeps everything.
  await app.evaluate(({ dialog, BrowserWindow }) => {
    (globalThis as Record<string, unknown>)['__prompts'] = 0;
    dialog.showMessageBoxSync = () => {
      ((globalThis as Record<string, unknown>)['__prompts'] as number) += 1;
      return 1;
    };
    BrowserWindow.getAllWindows()[0]!.close();
  });
  expect(await app.evaluate(() => (globalThis as Record<string, unknown>)['__prompts'])).toBe(1);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  expect(await sha(path)).toBe(before);

  // The renderer cannot write anywhere the user did not choose.
  const forbidden = await page.evaluate(async (target) => {
    const api = (window as unknown as { api: { documents: { writeFile(p: string, d: Uint8Array): Promise<unknown> } } }).api;
    return api.documents.writeFile(target, new TextEncoder().encode('%PDF-1.7 fake'));
  }, join(work, 'sneaky.pdf'));
  expect(forbidden).toEqual({ ok: false, error: 'notAllowed' });

  // Save: the file is replaced atomically with a valid PDF in the new order.
  await command(page, 'file.save').click();
  await expect(page.getByTestId('document-status')).toHaveText('No changes');
  expect(await sha(path)).not.toBe(before);
  expect(await describeFile(path)).toEqual([
    { width: 595, height: 842, rotation: 90 },
    { width: 792, height: 612, rotation: 0 },
    { width: 595, height: 842, rotation: 0 },
  ]);
  expect(await readdir(work)).toEqual(['document.pdf']);

  // With everything saved the window closes without a prompt.
  expect(errors).toEqual([]);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0);
  expect(await app.evaluate(() => (globalThis as Record<string, unknown>)['__prompts'])).toBe(1);
});

test('inserts PDFs and images, merges, extracts and splits', async () => {
  const { page, app, errors } = session;
  // A real 2x1 PNG: left pixel pure red, right pixel pure blue.
  const png = join(work, 'stripe.png');
  await writeFile(png, makePng(2, 1, [[255, 0, 0], [0, 0, 255]]));

  await openFiles(session, fixture('mixed-pages.pdf'));
  await expect(ready(page, 1)).toBeVisible();

  // Insert a whole PDF after page 1.
  await app.evaluate(({ dialog }, filePaths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths });
  }, [fixture('many-pages.pdf')]);
  await menuCommand('pages.insertFromPdf');
  await expect(pageStatus(page)).toContainText('/ 63');
  expect((await corners(page, 62)).left).toEqual(GREEN);

  // Import an image as a page after the current one.
  await app.evaluate(({ dialog }, filePaths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths });
  }, [png, fixture('not-a-pdf.pdf')]);
  await menuCommand('pages.importImages');
  const notice = page.getByRole('dialog', { name: 'Some files could not be opened' });
  await expect(notice).toContainText('not-a-pdf.pdf: not a supported image');
  await notice.getByRole('button', { name: 'OK' }).click();
  await expect(pageStatus(page)).toContainText('63 / 64');
  await expect(ready(page, 63)).toBeVisible();
  expect(await pagePixel(page, 63, 0.25, 0.5)).toEqual([255, 0, 0]);
  expect(await pagePixel(page, 63, 0.75, 0.5)).toEqual([0, 0, 255]);

  // Extract the image page and its neighbour into a separate file.
  await thumbnail(page, 63).click();
  await thumbnail(page, 64).click({ modifiers: ['ControlOrMeta'] });
  const part = join(work, 'part.pdf');
  await stubSaveDialog(part);
  await menuCommand('pages.extract');
  await expect.poll(() => readdir(work)).toContain('part.pdf');
  expect(await describeFile(part)).toEqual([
    { width: 842, height: 421, rotation: 0 },
    { width: 595, height: 842, rotation: 90 },
  ]);
  await expect(pageStatus(page)).toContainText('/ 64');

  // Merge two files into a new, unsaved document.
  await app.evaluate(({ dialog }, filePaths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths });
  }, [fixture('mixed-pages.pdf'), fixture('many-pages.pdf')]);
  await menuCommand('pages.merge');
  await expect(page.getByRole('tab', { name: /Untitled\.pdf/ })).toHaveAttribute('aria-selected', 'true');
  await expect(pageStatus(page)).toContainText('1 / 63');
  await expect(page.getByTestId('document-status')).toHaveText('Unsaved changes');

  // Split it into files of 25 pages; existing files in the folder are never overwritten.
  const parts = join(work, 'parts');
  await mkdir(parts);
  await writeFile(join(parts, 'Untitled-1.pdf'), 'keep me');
  await app.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
  }, parts);
  await menuCommand('pages.split');
  const split = page.getByRole('dialog', { name: 'Split document' });
  await split.getByLabel('Pages per file').fill('25');
  await expect(split).toContainText('Files to be created: 3');
  await split.getByRole('button', { name: 'Choose Folder and Split' }).click();
  await expect(page.getByRole('dialog', { name: 'Document split' })).toContainText('Files created: 3');
  expect((await readdir(parts)).sort()).toEqual(['Untitled-1 (2).pdf', 'Untitled-1.pdf', 'Untitled-2.pdf', 'Untitled-3.pdf']);
  expect(await readFile(join(parts, 'Untitled-1.pdf'), 'utf8')).toBe('keep me');
  expect((await describeFile(join(parts, 'Untitled-1 (2).pdf'))).length).toBe(25);
  expect((await describeFile(join(parts, 'Untitled-2.pdf'))).length).toBe(25);
  expect((await describeFile(join(parts, 'Untitled-3.pdf'))).length).toBe(13);

  expect(errors).toEqual([]);
});
