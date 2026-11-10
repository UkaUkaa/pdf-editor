import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isDocumentPath, readDocumentFile, sanitisePdfFileName, writeDocumentFile } from '../../../src/main/services/pdfFiles';
import { RecoveryStore } from '../../../src/main/services/recoveryStore';

let directory: string;
const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
const pdf = new TextEncoder().encode('%PDF-1.7\n%%EOF\n');
const ID = '0b9c7d0e-1111-4222-8333-444455556666';

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'pdf-editor-recovery-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('project files in the main process', () => {
  it('writes and reads projects only as ZIP data under the .pdfproject extension', async () => {
    const target = join(directory, 'work.pdfproject');
    expect(await writeDocumentFile(target, zip)).toEqual({ ok: true, path: target, size: zip.length });
    const read = await readDocumentFile(target);
    expect(read.ok && read.file.data).toEqual(zip);
    expect(await readdir(directory)).toEqual(['work.pdfproject']);

    // The content must match the extension in both directions.
    expect(await writeDocumentFile(target, pdf)).toEqual({ ok: false, error: 'invalid' });
    expect(await writeDocumentFile(join(directory, 'out.pdf'), zip)).toEqual({ ok: false, error: 'invalid' });
    expect(new Uint8Array(await readFile(target))).toEqual(zip);

    await writeFile(join(directory, 'fake.pdfproject'), 'just text');
    expect(await readDocumentFile(join(directory, 'fake.pdfproject'))).toMatchObject({ ok: false, error: 'notPdf' });
    expect(await readDocumentFile(join(directory, 'notes.txt'))).toMatchObject({ ok: false, error: 'notPdf' });
  });

  it('recognises document paths and builds safe file names for both kinds', () => {
    expect(isDocumentPath('/a/b.pdf')).toBe(true);
    expect(isDocumentPath('/a/b.PDFPROJECT')).toBe(true);
    expect(isDocumentPath('/a/b.zip')).toBe(false);
    expect(isDocumentPath('b.pdfproject')).toBe(false);
    expect(sanitisePdfFileName('../../report.pdf', 'project')).toBe('report.pdfproject');
    expect(sanitisePdfFileName('work.pdfproject', 'pdf')).toBe('work.pdf');
  });
});

describe('RecoveryStore', () => {
  const entry = { id: ID, name: 'report.pdf', path: '/docs/report.pdf' };

  it('lists nothing from the current session but everything left by an earlier one', async () => {
    const first = new RecoveryStore(directory);
    await first.prepare();
    expect(await first.write(entry, zip, 1000)).toBe(true);
    expect(await first.listLeftOver()).toEqual([]);

    // The process died; a new session finds the copy.
    const second = new RecoveryStore(directory);
    await second.prepare();
    expect(await second.listLeftOver()).toEqual([{ ...entry, savedAt: 1000, size: zip.length }]);
    expect((await second.read(ID))?.data).toEqual(zip);
    expect((await second.read(ID))?.entry.path).toBe('/docs/report.pdf');
  });

  it('removes its own copies on a clean exit and keeps those of earlier sessions', async () => {
    const crashed = new RecoveryStore(directory);
    await crashed.write(entry, zip);

    const next = new RecoveryStore(directory);
    await next.prepare();
    const other = { id: 'second-doc', name: 'Untitled.pdf', path: null };
    await next.write(other, zip);
    await next.removeSession();
    expect((await readdir(directory)).sort()).toEqual([`${ID}.json`, `${ID}.pdfproject`]);

    await next.remove(ID);
    expect(await readdir(directory)).toEqual([]);
    expect(await next.read(ID)).toBeNull();
  });

  it('replaces a copy atomically and newest entries come first', async () => {
    const store = new RecoveryStore(directory);
    await store.write(entry, zip, 1);
    const longer = new Uint8Array([...zip, 9, 9]);
    await store.write(entry, longer, 5);
    await store.write({ id: 'older', name: 'a.pdf', path: null }, zip, 2);
    expect((await readdir(directory)).every((name) => !name.endsWith('.tmp'))).toBe(true);

    const next = new RecoveryStore(directory);
    expect((await next.listLeftOver()).map((item) => [item.id, item.savedAt, item.size])).toEqual([
      [ID, 5, longer.length],
      ['older', 2, zip.length],
    ]);
  });

  it('rejects unsafe ids and data that is not an archive', async () => {
    const store = new RecoveryStore(directory);
    await store.prepare();
    expect(await store.write({ ...entry, id: '../escape' }, zip)).toBe(false);
    expect(await store.write({ ...entry, id: 'a/b' }, zip)).toBe(false);
    expect(await store.write(entry, pdf)).toBe(false);
    expect(await store.read('../escape')).toBeNull();
    await store.remove('../../settings');
    expect(await readdir(directory)).toEqual([]);
  });

  it('ignores damaged entries and clears interrupted writes', async () => {
    await writeFile(join(directory, 'broken.json'), '{not json');
    await writeFile(join(directory, 'orphan.json'), JSON.stringify({ id: 'orphan', name: 'x', path: null, savedAt: 1 }));
    await writeFile(join(directory, 'mismatch.json'), JSON.stringify({ id: 'other', name: 'x', path: null, savedAt: 1 }));
    await writeFile(join(directory, 'mismatch.pdfproject'), zip);
    await writeFile(join(directory, 'nodata.pdfproject.abc123.tmp'), 'partial');
    const store = new RecoveryStore(directory);
    await store.prepare();
    expect(await store.listLeftOver()).toEqual([]);
    expect((await readdir(directory)).some((name) => name.endsWith('.tmp'))).toBe(false);
  });
});
