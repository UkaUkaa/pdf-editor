import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_RECENT_FILES } from '@shared/types/document';
import { readPdfFile } from '../../../src/main/services/pdfFiles';
import { RecentFilesStore } from '../../../src/main/services/recentFiles';

const fixture = (name: string): string => resolve('tests/fixtures', name);
let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'pdf-editor-files-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('readPdfFile', () => {
  it('reads a real PDF completely', async () => {
    const path = fixture('mixed-pages.pdf');
    const result = await readPdfFile(path);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const expected = await readFile(path);
    expect(result.file).toMatchObject({ path, name: 'mixed-pages.pdf', size: expected.length });
    expect(Buffer.from(result.file.data).equals(expected)).toBe(true);
    // Must be a plain Uint8Array so that it survives structured cloning.
    expect(Object.getPrototypeOf(result.file.data)).toBe(Uint8Array.prototype);
  });

  it('refuses everything that is not a readable PDF file', async () => {
    const error = async (path: string, max?: number) => {
      const result = await readPdfFile(path, max);
      return result.ok ? 'ok' : result.error;
    };
    expect(await error(join(directory, 'missing.pdf'))).toBe('notFound');
    expect(await error('relative/file.pdf')).toBe('notFound');
    expect(await error(fixture('not-a-pdf.pdf'))).toBe('notPdf');
    expect(await error(resolve('package.json'))).toBe('notPdf');
    expect(await error(fixture('mixed-pages.pdf'), 100)).toBe('tooLarge');

    await mkdir(join(directory, 'folder.pdf'));
    expect(await error(join(directory, 'folder.pdf'))).toBe('notPdf');

    // A text file renamed to .pdf must not be readable through this endpoint.
    await writeFile(join(directory, 'secret.pdf'), 'api-key=123');
    expect(await error(join(directory, 'secret.pdf'))).toBe('notPdf');
  });

  it('accepts a PDF header preceded by junk and an upper-case extension', async () => {
    const path = join(directory, 'SCAN.PDF');
    await writeFile(path, Buffer.concat([Buffer.from('\n\njunk\n'), await readFile(fixture('mixed-pages.pdf'))]));
    expect((await readPdfFile(path)).ok).toBe(true);
  });
});

describe('RecentFilesStore', () => {
  it('keeps the newest file first, without duplicates, and persists', async () => {
    const a = fixture('mixed-pages.pdf');
    const b = fixture('many-pages.pdf');
    const store = new RecentFilesStore(directory);
    await store.load();
    await store.add(a, 1);
    await store.add(b, 2);
    await store.add(a, 3);
    expect((await store.list()).map((file) => file.name)).toEqual(['mixed-pages.pdf', 'many-pages.pdf']);

    const reloaded = new RecentFilesStore(directory);
    await reloaded.load();
    expect(await reloaded.list()).toEqual([
      { path: a, name: 'mixed-pages.pdf', openedAt: 3 },
      { path: b, name: 'many-pages.pdf', openedAt: 2 },
    ]);
  });

  it('hides files that no longer exist, caps the list and can be cleared', async () => {
    const store = new RecentFilesStore(directory);
    await store.load();
    for (let index = 0; index < MAX_RECENT_FILES + 5; index += 1) {
      const path = join(directory, `file-${index}.pdf`);
      await writeFile(path, '%PDF-');
      await store.add(path, index);
    }
    expect(await store.list()).toHaveLength(MAX_RECENT_FILES);

    await rm(join(directory, `file-${MAX_RECENT_FILES + 4}.pdf`));
    const list = await store.list();
    expect(list).toHaveLength(MAX_RECENT_FILES - 1);
    expect(list[0]?.name).toBe(`file-${MAX_RECENT_FILES + 3}.pdf`);

    await store.clear();
    expect(await store.list()).toEqual([]);
  });

  it('starts empty when the stored list is unreadable', async () => {
    await writeFile(join(directory, 'recent-files.json'), 'garbage');
    const store = new RecentFilesStore(directory);
    await store.load();
    expect(await store.list()).toEqual([]);
  });
});
