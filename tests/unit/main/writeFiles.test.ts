import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isPdfPath,
  readImageFile,
  sanitisePdfFileName,
  uniquePdfPath,
  writeImageFile,
  writePdfFile,
} from '../../../src/main/services/pdfFiles';

let directory: string;
const pdf = new TextEncoder().encode('%PDF-1.7\n%%EOF\n');

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'pdf-editor-write-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('writePdfFile', () => {
  it('writes the file, replaces an existing one and leaves no temporary files', async () => {
    const target = join(directory, 'out.pdf');
    await writeFile(target, 'old content');
    expect(await writePdfFile(target, pdf)).toEqual({ ok: true, path: target, size: pdf.length });
    expect(new Uint8Array(await readFile(target))).toEqual(pdf);
    expect(await readdir(directory)).toEqual(['out.pdf']);
  });

  it('refuses anything that is not a PDF going to a .pdf path, without touching the target', async () => {
    const target = join(directory, 'keep.pdf');
    await writeFile(target, 'precious');
    expect(await writePdfFile(target, new TextEncoder().encode('not a pdf'))).toEqual({ ok: false, error: 'invalid' });
    expect(await writePdfFile(target, new Uint8Array())).toEqual({ ok: false, error: 'invalid' });
    expect(await writePdfFile(join(directory, 'script.sh'), pdf)).toEqual({ ok: false, error: 'invalid' });
    expect(await writePdfFile('relative.pdf', pdf)).toEqual({ ok: false, error: 'invalid' });
    expect(await readFile(target, 'utf8')).toBe('precious');
  });

  it('reports a failure when the location cannot be written', async () => {
    const blocker = join(directory, 'file');
    await writeFile(blocker, 'x');
    // The parent "directory" is a regular file.
    expect(await writePdfFile(join(blocker, 'out.pdf'), pdf)).toEqual({ ok: false, error: 'writeFailed' });
  });
});

describe('file names', () => {
  it('reduces suggestions to a safe .pdf file name', () => {
    expect(sanitisePdfFileName('Report 2026.pdf')).toBe('Report 2026.pdf');
    expect(sanitisePdfFileName('../../etc/passwd')).toBe('passwd.pdf');
    expect(sanitisePdfFileName('C:\\Users\\me\\doc.PDF')).toBe('doc.pdf');
    expect(sanitisePdfFileName('a<b>:c|d?.pdf')).toBe('a_b__c_d_.pdf');
    expect(sanitisePdfFileName('.hidden')).toBe('hidden.pdf');
    expect(sanitisePdfFileName('...')).toBe('document.pdf');
    expect(sanitisePdfFileName('Отчёт за год.pdf')).toBe('Отчёт за год.pdf');
    expect(sanitisePdfFileName('')).toBe('document.pdf');
    expect(isPdfPath(resolve('a.PDF'))).toBe(true);
    expect(isPdfPath('a.pdf')).toBe(false);
    expect(isPdfPath(resolve('a.txt'))).toBe(false);
  });

  it('never proposes a name that already exists', async () => {
    expect(await uniquePdfPath(directory, 'part.pdf')).toBe(join(directory, 'part.pdf'));
    await writeFile(join(directory, 'part.pdf'), 'x');
    await writeFile(join(directory, 'part (2).pdf'), 'x');
    expect(await uniquePdfPath(directory, 'part.pdf')).toBe(join(directory, 'part (3).pdf'));
    expect(await uniquePdfPath(directory, '../escape.pdf')).toBe(join(directory, 'escape.pdf'));
  });
});

describe('readImageFile', () => {
  it('accepts supported image extensions and refuses everything else', async () => {
    const image = join(directory, 'photo.JPG');
    await writeFile(image, 'bytes');
    const ok = await readImageFile(image);
    expect(ok.ok && ok.file.name).toBe('photo.JPG');

    const error = async (path: string, max?: number) => {
      const result = await readImageFile(path, max);
      return result.ok ? 'ok' : result.error;
    };
    expect(await error(resolve('package.json'))).toBe('notImage');
    expect(await error(resolve('tests/fixtures/mixed-pages.pdf'))).toBe('notImage');
    expect(await error(join(directory, 'missing.png'))).toBe('notFound');
    expect(await error(image, 2)).toBe('tooLarge');
  });
});

describe('writeImageFile', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

  it('writes PNG and JPEG data under matching names and never overwrites', async () => {
    expect(await writeImageFile(directory, 'page-1.png', png)).toEqual({ ok: true, path: join(directory, 'page-1.png'), size: png.length });
    expect(await writeImageFile(directory, 'page-1.png', png)).toMatchObject({ ok: true, path: join(directory, 'page-1 (2).png') });
    expect(await writeImageFile(directory, '../../page-2.jpg', jpeg)).toMatchObject({ ok: true, path: join(directory, 'page-2.jpg') });
    expect((await readdir(directory)).sort()).toEqual(['page-1 (2).png', 'page-1.png', 'page-2.jpg']);
  });

  it('refuses data that is not the image its name claims', async () => {
    const text = new TextEncoder().encode('#!/bin/sh');
    expect(await writeImageFile(directory, 'script.png', text)).toEqual({ ok: false, error: 'invalid' });
    expect(await writeImageFile(directory, 'page.jpg', png)).toEqual({ ok: false, error: 'invalid' });
    expect(await writeImageFile(directory, 'page.sh', png)).toEqual({ ok: false, error: 'invalid' });
    expect(await writeImageFile('relative', 'page.png', png)).toEqual({ ok: false, error: 'invalid' });
    expect(await readdir(directory)).toEqual([]);
  });
});
