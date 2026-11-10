import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createProfile, fixture, launch, openFiles, pagePixel, removeProfile, type Session } from './helpers';

let userData: string;
let session: Session;

const ready = (page: Page, number: number) =>
  page.locator(`.viewer__page[data-page-number="${number}"] canvas[data-status="ready"]`);
const statusField = (page: Page, id: string) => page.getByTestId(`status-${id}`);
const zoomOf = async (page: Page): Promise<number> => Number(await page.locator('.viewer').getAttribute('data-zoom'));

test.beforeEach(async () => {
  userData = await createProfile({ language: 'en', theme: 'light' });
  session = await launch(userData);
});

test.afterEach(async () => {
  await session.app.close().catch(() => undefined);
  await removeProfile(userData);
});

test('renders real PDF pages with correct content, sizes and rotation', async () => {
  const { page, errors } = session;
  await openFiles(session, fixture('mixed-pages.pdf'));

  await expect(page.getByRole('tab', { name: 'mixed-pages.pdf' })).toHaveAttribute('aria-selected', 'true');
  await expect(ready(page, 1)).toBeVisible();
  await expect(statusField(page, 'page')).toContainText('1 / 3');
  await expect(statusField(page, 'size')).toContainText('210 × 297 mm');
  await expect(page).toHaveTitle('mixed-pages.pdf — PDF Editor');

  // Page 1: red block in the top-left corner, white paper elsewhere.
  expect(await pagePixel(page, 1, 0.1, 0.05)).toEqual([219, 38, 38]);
  expect(await pagePixel(page, 1, 0.9, 0.9)).toEqual([255, 255, 255]);

  // Aspect ratios follow the real page boxes, including the rotated page.
  const ratio = async (number: number): Promise<number> => {
    await page.locator('.toolbar__page-input').fill(String(number));
    await page.locator('.toolbar__page-input').press('Enter');
    await expect(ready(page, number)).toBeVisible();
    const box = (await page.locator(`.viewer__page[data-page-number="${number}"]`).boundingBox())!;
    return box.width / box.height;
  };
  expect(await ratio(2)).toBeCloseTo(792 / 612, 2);
  await expect(statusField(page, 'size')).toContainText('279 × 216 mm');
  expect(await ratio(3)).toBeCloseTo(841.89 / 595.28, 2);
  await expect(statusField(page, 'size')).toContainText('297 × 210 mm');

  // /Rotate 90 turns the page clockwise: its top-left block ends up top-right.
  expect(await pagePixel(page, 3, 0.95, 0.1)).toEqual([38, 76, 217]);
  expect(await pagePixel(page, 3, 0.05, 0.1)).toEqual([255, 255, 255]);
  expect(await pagePixel(page, 2, 0.05, 0.1)).toEqual([26, 153, 51]);

  // Thumbnails are rendered from the same pages.
  await expect(page.locator('.thumbnail')).toHaveCount(3);
  await expect(page.locator('.thumbnail[data-page-number="3"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.thumbnail canvas[data-status="ready"]')).toHaveCount(3);

  expect(errors).toEqual([]);
});

test('virtualises, navigates, scrolls and zooms a long document', async () => {
  const { page, errors } = session;
  await openFiles(session, fixture('many-pages.pdf'));
  await expect(ready(page, 1)).toBeVisible();
  await expect(statusField(page, 'page')).toContainText('1 / 60');

  // Only pages near the viewport exist in the DOM.
  expect(await page.locator('.viewer__page').count()).toBeLessThan(8);
  expect(await page.locator('.thumbnail').count()).toBeLessThan(20);

  // Jump far ahead: the target page is rendered and its thumbnail scrolled into view.
  await page.locator('.toolbar__page-input').fill('30');
  await page.locator('.toolbar__page-input').press('Enter');
  await expect(ready(page, 30)).toBeVisible();
  await expect(statusField(page, 'page')).toContainText('30 / 60');
  await expect(page.locator('.thumbnail[data-page-number="30"]')).toBeInViewport();
  await expect(page.locator('.viewer__page[data-page-number="1"]')).toHaveCount(0);

  // Scrolling with the wheel updates the current page.
  await page.locator('.viewer').hover();
  await page.mouse.wheel(0, 3000);
  await expect(statusField(page, 'page')).not.toContainText('30 / 60');
  const afterScroll = await statusField(page, 'page').textContent();
  expect(Number(afterScroll?.match(/(\d+) \/ 60/)?.[1])).toBeGreaterThan(30);

  // Commands from the toolbar.
  await page.locator('[data-command="view.nextPage"]').click();
  const current = Number((await statusField(page, 'page').textContent())?.match(/(\d+) \/ 60/)?.[1]);
  await expect(ready(page, current)).toBeVisible();

  // Zoom in: the page gets bigger, is re-rendered sharper, and stays the current page.
  const before = await zoomOf(page);
  const widthBefore = await ready(page, current).evaluate((canvas: HTMLCanvasElement) => canvas.width);
  await page.locator('[data-command="view.zoomIn"]').click();
  await expect.poll(() => zoomOf(page)).toBeGreaterThan(before);
  await expect
    .poll(() => ready(page, current).evaluate((canvas: HTMLCanvasElement) => canvas.width))
    .toBeGreaterThan(widthBefore);
  await expect(statusField(page, 'page')).toContainText(`${current} / 60`);

  // Ctrl + wheel zooms out again without losing the place in the document.
  const zoomedIn = await zoomOf(page);
  // (Dispatched directly: Playwright's synthetic wheel does not carry the Ctrl modifier.)
  await page.locator('.viewer').dispatchEvent('wheel', { deltaY: 200, ctrlKey: true, bubbles: true, cancelable: true });
  await expect.poll(() => zoomOf(page)).toBeLessThan(zoomedIn);
  await expect(statusField(page, 'page')).toContainText(`${current} / 60`);

  // Fit page shows a whole page; two-page mode puts two pages side by side.
  await page.locator('.toolbar__zoom').selectOption('fitPage');
  await expect(page.locator(`.viewer__page[data-page-number="${current}"]`)).toBeInViewport({ ratio: 0.99 });
  await page.locator('.toolbar__zoom').selectOption('fitWidth');
  await session.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.webContents.send('menu:command', 'view.twoPage'),
  );
  await page.locator('.toolbar__page-input').fill('11');
  await page.locator('.toolbar__page-input').press('Enter');
  await expect(ready(page, 11)).toBeVisible();
  await expect(ready(page, 12)).toBeVisible();
  const left = (await page.locator('.viewer__page[data-page-number="11"]').boundingBox())!;
  const right = (await page.locator('.viewer__page[data-page-number="12"]').boundingBox())!;
  expect(Math.round(left.y)).toBe(Math.round(right.y));
  expect(right.x).toBeGreaterThan(left.x + left.width);

  // Hand tool: dragging pans the document.
  await page.locator('[data-command="tools.hand"]').click();
  const scrollBefore = await page.locator('.viewer').evaluate((element) => element.scrollTop);
  const viewer = (await page.locator('.viewer').boundingBox())!;
  await page.mouse.move(viewer.x + viewer.width / 2, viewer.y + viewer.height / 2);
  await page.mouse.down();
  await page.mouse.move(viewer.x + viewer.width / 2, viewer.y + viewer.height / 2 - 150, { steps: 4 });
  await page.mouse.up();
  expect(await page.locator('.viewer').evaluate((element) => element.scrollTop)).toBe(scrollBefore + 150);

  expect(errors).toEqual([]);
});

test('handles several documents, bad files, passwords and recent files', async () => {
  const { page, errors } = session;

  // Two good files and two bad ones in a single request.
  await openFiles(
    session,
    fixture('mixed-pages.pdf'),
    fixture('not-a-pdf.pdf'),
    fixture('corrupt.pdf'),
    fixture('many-pages.pdf'),
  );
  const notice = page.getByRole('dialog', { name: 'Some files could not be opened' });
  await expect(notice).toContainText('not-a-pdf.pdf: not a PDF or project file');
  await expect(notice).toContainText('corrupt.pdf: the file is damaged or is not a valid PDF');
  await notice.getByRole('button', { name: 'OK' }).click();

  await expect(page.locator('.tabs__tab')).toHaveCount(2);
  await expect(page.getByRole('tab', { name: 'many-pages.pdf' })).toHaveAttribute('aria-selected', 'true');
  await expect(statusField(page, 'page')).toContainText('1 / 60');
  await page.getByRole('tab', { name: 'mixed-pages.pdf' }).click();
  await expect(statusField(page, 'page')).toContainText('1 / 3');
  await expect(ready(page, 1)).toBeVisible();

  // Encrypted document: wrong password, then the right one.
  await openFiles(session, fixture('encrypted.pdf'));
  const password = page.getByRole('dialog', { name: 'Password required' });
  await password.getByLabel('Password').fill('wrong');
  await password.getByRole('button', { name: 'Open' }).click();
  await expect(password.getByRole('alert')).toContainText('Incorrect password');
  await password.getByLabel('Password').fill('secret');
  await password.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('tab', { name: 'encrypted.pdf' })).toHaveAttribute('aria-selected', 'true');
  await expect(ready(page, 1)).toBeVisible();
  // The orange rectangle only appears if the content stream was really decrypted.
  expect(await pagePixel(page, 1, 0.25, 0.35)).toEqual([230, 128, 26]);

  // Closing tabs returns to the welcome screen, which now lists the recent files.
  for (const name of ['encrypted.pdf', 'mixed-pages.pdf', 'many-pages.pdf']) {
    await page.getByRole('button', { name: `Close ${name}` }).click();
  }
  await expect(page.getByRole('heading', { name: 'Open a PDF to get started' })).toBeVisible();
  await expect(page.locator('.recent-item__name')).toHaveText(['encrypted.pdf', 'many-pages.pdf', 'mixed-pages.pdf']);
  expect(errors).toEqual([]);

  // Recent files survive a restart and open with one click.
  await session.app.close();
  const stored = JSON.parse(await readFile(join(userData, 'recent-files.json'), 'utf8')) as Array<{ name: string }>;
  expect(stored.map((file) => file.name)).toEqual(['encrypted.pdf', 'many-pages.pdf', 'mixed-pages.pdf']);

  session = await launch(userData);
  await session.page.locator('.recent-item', { hasText: 'mixed-pages.pdf' }).click();
  await expect(ready(session.page, 1)).toBeVisible();
  expect(await pagePixel(session.page, 1, 0.1, 0.05)).toEqual([219, 38, 38]);
  expect(session.errors).toEqual([]);
});
