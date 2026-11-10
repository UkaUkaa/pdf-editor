import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

export const fixture = (name: string): string => resolve('tests/fixtures', name);

export interface Session {
  app: ElectronApplication;
  page: Page;
  /** Console errors and uncaught exceptions seen in the renderer. */
  errors: string[];
}

/** Creates an isolated profile directory so tests never touch the developer's own settings. */
export async function createProfile(settings: Record<string, unknown> = {}): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'pdf-editor-e2e-'));
  if (Object.keys(settings).length > 0) {
    await writeFile(join(directory, 'settings.json'), JSON.stringify({ schemaVersion: 1, ...settings }));
  }
  await writeFile(join(directory, 'window-state.json'), JSON.stringify({ width: 1280, height: 800, maximized: false }));
  return directory;
}

export const removeProfile = (directory: string): Promise<void> => rm(directory, { recursive: true, force: true });

/** Launches the real built application (main + preload + renderer). */
export async function launch(userData: string): Promise<Session> {
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, PDF_EDITOR_USER_DATA: userData, ELECTRON_RENDERER_URL: '' },
  });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.waitForSelector('.app');
  return { app, page, errors };
}

/** Makes the native "Open" dialog return the given files, then triggers File > Open from the toolbar. */
export async function openFiles({ app, page }: Session, ...paths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, filePaths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths });
  }, paths);
  await page.locator('[data-command="file.open"]').click();
}

/** Displayed RGB at the given fraction of the rendered page. */
export function pagePixel(page: Page, pageNumber: number, fx: number, fy: number): Promise<number[]> {
  return page.evaluate(
    ([number, x, y]) => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        `.viewer__page[data-page-number="${number}"] canvas[data-status="ready"]`,
      );
      const context = canvas?.getContext('2d');
      if (!canvas || !context) return [];
      const data = context.getImageData(Math.floor(canvas.width * x!), Math.floor(canvas.height * y!), 1, 1).data;
      // Composite over the white paper behind the canvas, i.e. what is actually displayed
      // (a blank page has a fully transparent canvas).
      const alpha = data[3]! / 255;
      return [0, 1, 2].map((channel) => Math.round(data[channel]! * alpha + 255 * (1 - alpha)));
    },
    [pageNumber, fx, fy] as const,
  );
}

/** Encodes a real RGB PNG; `pixels` holds one [r, g, b] triple per pixel, row by row. */
export function makePng(width: number, height: number, pixels: number[][]): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits per channel, RGB, no interlace
  const rows: number[] = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(0); // filter: none
    for (let x = 0; x < width; x += 1) rows.push(...pixels[y * width + x]!);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
