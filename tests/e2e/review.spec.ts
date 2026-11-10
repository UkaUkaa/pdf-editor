import { readFile, writeFile } from 'node:fs/promises';
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

async function at(page: Page, fx: number, fy: number): Promise<[number, number]> {
  const box = (await firstPage(page).boundingBox())!;
  return [box.x + box.width * fx, box.y + box.height * fy];
}

async function saveAs(target: string, tabName: string): Promise<void> {
  await session.app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, target);
  await menuCommand('file.saveAs');
  await expect(session.page.getByRole('tab', { name: tabName })).toBeVisible();
  await expect(session.page.getByTestId('document-status')).toHaveText('No changes');
}

type RawAnnotation = { id: string; subtype: string; contentsObj?: { str: string }; titleObj?: { str: string }; inReplyTo?: string; url?: string; dest?: unknown[] };

/** Annotations of page 1 and the attachment names of a saved file, read with an independent parser. */
async function inspect(path: string) {
  const document = await getDocument({
    data: new Uint8Array(await readFile(path)),
    disableFontFace: true,
    standardFontDataUrl: `${resolve('node_modules/pdfjs-dist/standard_fonts')}/`,
  }).promise;
  const annotations = (await (await document.getPage(1)).getAnnotations({ intent: 'any' })) as RawAnnotation[];
  const attachments = await document.getAttachments();
  const linkPage = async (annotation: RawAnnotation) => (annotation.dest ? document.getPageIndex(annotation.dest[0] as never) : null);
  const result = {
    comments: annotations.filter((item) => item.subtype === 'Text').map((item) => ({ text: item.contentsObj?.str, author: item.titleObj?.str, reply: Boolean(item.inReplyTo) })),
    links: await Promise.all(annotations.filter((item) => item.subtype === 'Link').map(async (item) => item.url ?? `page:${await linkPage(item)}`)),
    attachments: attachments instanceof Map ? [...attachments.keys()] : Object.keys(attachments ?? {}),
  };
  await document.loadingTask.destroy();
  return result;
}

test.beforeEach(async () => {
  userData = await createProfile({ language: 'en', theme: 'light', authorName: 'Reviewer' });
  session = await launch(userData);
});

test.afterEach(async () => {
  await session.app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 0;
  });
  await session.app.close().catch(() => undefined);
  await removeProfile(userData);
});

test('comments, links, attachments and text markup survive saving and reopening', async () => {
  const { page, app, errors } = session;
  await openFiles(session, fixture('mixed-pages.pdf'));
  await expect(firstPage(page).locator('canvas[data-status="ready"]')).toBeVisible();
  await page.locator('.toolbar__zoom').selectOption('fitPage');
  await expect(firstPage(page)).toBeInViewport({ ratio: 1 });

  // --- A comment with a reply -----------------------------------------------------------
  await page.locator('.toolbar [data-command="tools.comment"]').click();
  await page.mouse.click(...(await at(page, 0.7, 0.3)));
  const comment = page.getByLabel('Comment text');
  await expect(comment).toBeFocused();
  await page.keyboard.type('Проверить эту страницу');
  await page.getByLabel('Reply…').fill('Проверено');
  await page.getByLabel('Reply…').press('Enter');
  await expect(page.locator('.comment__reply-text')).toHaveText('Проверено');
  await expect(page.locator('.comment__author').first()).toHaveText('Reviewer');
  await expect(firstPage(page).locator('.editor-object[data-object-type="note"]')).toHaveCount(1);

  // --- A web link and a link to page 3 ----------------------------------------------------
  const drawLink = async (from: [number, number], to: [number, number]): Promise<void> => {
    await page.locator('.toolbar [data-command="insert.link"]').click();
    await page.mouse.move(...(await at(page, ...from)));
    await page.mouse.down();
    await page.mouse.move(...(await at(page, ...to)), { steps: 4 });
    await page.mouse.up();
  };
  await drawLink([0.1, 0.8], [0.4, 0.84]);
  const address = page.locator('.properties').getByRole('textbox', { name: 'Address' });
  await address.fill('file:///etc/passwd');
  await expect(page.locator('.properties').getByRole('alert')).toContainText('Only web');
  await address.fill('example.com/guide');
  await address.press('Enter');
  await expect(page.locator('.properties').getByRole('button', { name: 'Follow link' })).toBeEnabled();

  // Following an external link asks first and opens nothing by itself.
  await app.evaluate(({ shell }) => {
    (globalThis as Record<string, unknown>)['__opened'] = [];
    shell.openExternal = async (url: string) => {
      ((globalThis as Record<string, unknown>)['__opened'] as string[]).push(url);
    };
  });
  await page.locator('.properties').getByRole('button', { name: 'Follow link' }).click();
  const prompt = page.getByRole('dialog', { name: 'Open external link?' });
  await expect(prompt).toContainText('https://example.com/guide');
  await prompt.getByRole('button', { name: 'Cancel' }).click();
  expect(await app.evaluate(() => (globalThis as Record<string, unknown>)['__opened'])).toEqual([]);
  // The main process refuses unsafe addresses even if asked directly.
  const refused = await page.evaluate(() =>
    (window as unknown as { api: { app: { openExternal(url: string): Promise<boolean> } } }).api.app.openExternal('file:///etc/passwd'),
  );
  expect(refused).toBe(false);
  await page.locator('.properties').getByRole('button', { name: 'Follow link' }).click();
  await page.getByRole('dialog', { name: 'Open external link?' }).getByRole('button', { name: 'Open' }).click();
  await expect.poll(() => app.evaluate(() => (globalThis as Record<string, unknown>)['__opened'])).toEqual(['https://example.com/guide']);

  await drawLink([0.1, 0.88], [0.4, 0.92]);
  await page.locator('.properties').getByRole('radio', { name: 'Page' }).check();
  await page.locator('.properties').getByLabel('Page number').fill('3');
  await page.locator('.properties').getByRole('button', { name: 'Follow link' }).click();
  await expect(page.getByTestId('status-page')).toContainText('3 / 3');
  await page.locator('.toolbar__page-input').fill('1');
  await page.locator('.toolbar__page-input').press('Enter');

  // --- Underline the line of original text ----------------------------------------------
  await page.locator('[data-action="markup"]').click();
  await page.getByRole('menuitemcheckbox', { name: 'Underline Text' }).click();
  await firstPage(page).locator('.text-run[data-text-run="Page 1 - A4 portrait"]').click();
  await expect(firstPage(page).locator('.editor-object[data-object-type="shape"]')).toHaveCount(1);

  // --- Attach a file ----------------------------------------------------------------------
  const attachment = join(userData, 'заметки.txt');
  await writeFile(attachment, 'attached text');
  await app.evaluate(({ dialog }, filePaths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths });
  }, [attachment]);
  await page.getByRole('tab', { name: 'Attachments', exact: true }).click();
  await page.locator('[data-command="insert.attachment"]').click();
  await expect(page.locator('.attachment__name')).toHaveText(['заметки.txt']);

  // --- Save and read the file with an independent parser -------------------------------------
  const target = join(userData, 'reviewed.pdf');
  await saveAs(target, 'reviewed.pdf');
  expect(await inspect(target)).toEqual({
    comments: [
      { text: 'Проверить эту страницу', author: 'Reviewer', reply: false },
      { text: 'Проверено', author: 'Reviewer', reply: true },
    ],
    links: ['https://example.com/guide', 'page:2'],
    attachments: ['заметки.txt'],
  });
  expect(errors).toEqual([]);

  // --- Reopen: everything is editable again, nothing is duplicated on the next save -----------
  await session.app.close();
  session = await launch(userData);
  const reopened = session.page;
  await reopened.locator('.recent-item', { hasText: 'reviewed.pdf' }).click();
  await expect(firstPage(reopened).locator('canvas[data-status="ready"]')).toBeVisible();
  await expect(reopened.getByTestId('document-status')).toHaveText('No changes');
  await expect(firstPage(reopened).locator('.editor-object[data-object-type="note"]')).toHaveCount(1);
  await expect(firstPage(reopened).locator('.editor-object[data-object-type="link"]')).toHaveCount(2);

  await reopened.getByRole('tab', { name: 'Comments', exact: true }).click();
  await expect(reopened.getByLabel('Comment text')).toHaveValue('Проверить эту страницу');
  await expect(reopened.locator('.comment__reply-text')).toHaveText('Проверено');
  await reopened.getByLabel('Comment text').fill('Проверить и подписать');
  await reopened.getByLabel('Reply…').click();

  // The attachment came back and can be extracted byte for byte.
  await reopened.getByRole('tab', { name: 'Attachments', exact: true }).click();
  await expect(reopened.locator('.attachment__name')).toHaveText(['заметки.txt']);
  const extracted = join(userData, 'extracted.txt');
  await session.app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, extracted);
  await reopened.getByRole('button', { name: /Save заметки\.txt to disk/ }).click();
  await expect.poll(() => readFile(extracted, 'utf8').catch(() => '')).toBe('attached text');

  const second = join(userData, 'reviewed-2.pdf');
  await saveAs(second, 'reviewed-2.pdf');
  expect(await inspect(second)).toEqual({
    comments: [
      { text: 'Проверить и подписать', author: 'Reviewer', reply: false },
      { text: 'Проверено', author: 'Reviewer', reply: true },
    ],
    links: ['https://example.com/guide', 'page:2'],
    attachments: ['заметки.txt'],
  });
  expect(session.errors).toEqual([]);
});
