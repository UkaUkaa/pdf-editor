import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { createProfile, launch as launchApp, removeProfile } from './helpers';

let userData: string;
const launch = () => launchApp(userData);

test.beforeAll(async () => {
  userData = await createProfile();
});

test.afterAll(async () => {
  await removeProfile(userData);
});

test('shell starts securely, settings work and survive a restart', async () => {
  let { app, page, errors } = await launch();

  // --- Security posture of the renderer -------------------------------------------------
  expect(new URL(page.url()).protocol).toBe('app:');
  const exposure = await page.evaluate(() => ({
    require: typeof (globalThis as Record<string, unknown>)['require'],
    process: typeof (globalThis as Record<string, unknown>)['process'],
    apiKeys: Object.keys((globalThis as unknown as { api: object }).api).sort(),
  }));
  expect(exposure).toEqual({ require: 'undefined', process: 'undefined', apiKeys: ['app', 'documents', 'fonts', 'menu', 'platform', 'recent', 'recovery', 'settings'] });

  // The CSP must block inline script execution.
  const inlineRan = await page.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = 'window.__inlineRan = true';
    document.head.append(script);
    return (window as unknown as { __inlineRan?: boolean }).__inlineRan === true;
  });
  expect(inlineRan).toBe(false);
  await expect.poll(() => errors.some((text) => text.includes('Content Security Policy'))).toBe(true);
  errors.length = 0; // the violation above is the expected outcome of the probe

  // Invalid IPC payloads are rejected by the main process.
  const rejected = await page.evaluate(async () => {
    try {
      await (window as unknown as { api: { settings: { update: (p: unknown) => Promise<unknown> } } }).api.settings.update({
        language: 'xx',
      });
      return false;
    } catch {
      return true;
    }
  });
  expect(rejected).toBe(true);

  // --- Layout ---------------------------------------------------------------------------
  await expect(page.getByRole('toolbar')).toBeVisible();
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.workspace')).toBeVisible();
  await expect(page.locator('.properties')).toBeVisible();
  await expect(page.locator('.statusbar')).toBeVisible();

  // --- Language: switch to Ukrainian through the settings dialog -------------------------
  await page.locator('[data-command="settings.preferences"]').click();
  await page.getByRole('dialog').locator('select').first().selectOption('uk');
  await expect(page.getByRole('dialog', { name: 'Параметри' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Відкрийте PDF, щоб почати' })).toBeVisible();

  // The native macOS menu follows the interface language.
  if (process.platform === 'darwin') {
    await expect
      .poll(() => app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map((item) => item.label) ?? []))
      .toContain('Сторінки');
  }

  // --- Theme ----------------------------------------------------------------------------
  const before = await page.evaluate(() => document.documentElement.dataset['theme']);
  await page.locator('[data-action="toggle-theme"]').click();
  const after = before === 'dark' ? 'light' : 'dark';
  await expect(page.locator('html')).toHaveAttribute('data-theme', after);
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(background).toBe(after === 'dark' ? 'rgb(27, 29, 33)' : 'rgb(243, 244, 246)');

  // --- Panels: collapse the left one, resize the right one by dragging -------------------
  await page.locator('[data-command="view.toggleLeftPanel"]').click();
  await expect(page.locator('.sidebar')).toHaveCount(0);

  const handle = page.locator('.resize-handle[data-side="right"]');
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await page.locator('.properties').boundingBox())!.width)).toBe(380);

  expect(errors).toEqual([]);
  await app.close();

  // --- Persistence ----------------------------------------------------------------------
  const stored = JSON.parse(await readFile(join(userData, 'settings.json'), 'utf8'));
  expect(stored).toMatchObject({
    language: 'uk',
    theme: after,
    layout: { leftCollapsed: true, rightWidth: 380 },
  });

  ({ app, page, errors } = await launch());
  await expect(page.getByRole('heading', { name: 'Відкрийте PDF, щоб почати' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', after);
  await expect(page.locator('html')).toHaveAttribute('lang', 'uk');
  await expect(page.locator('.sidebar')).toHaveCount(0);
  expect(Math.round((await page.locator('.properties').boundingBox())!.width)).toBe(380);

  // Restore the layout through the real command path and check it is applied.
  await page.locator('[data-command="settings.preferences"]').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Відновити розташування за замовчуванням' }).click();
  await expect(page.locator('.sidebar')).toBeVisible();

  expect(errors).toEqual([]);

  // --- Navigation away from the bundle and new windows are blocked ----------------------
  // Checked last and from the main process: Playwright keeps waiting on a cancelled navigation.
  await page.evaluate(() => {
    window.open('https://example.com');
    setTimeout(() => (window.location.href = 'https://example.com'), 0);
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  const windows = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((window) => window.webContents.getURL()),
  );
  expect(windows).toEqual(['app://bundle/index.html']);

  await app.close();
});
