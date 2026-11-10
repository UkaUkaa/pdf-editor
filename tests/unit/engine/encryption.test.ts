import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import type { PageModel } from '@shared/types/document';
import { buildPdf, ExportError } from '@renderer/engine/export/buildPdf';

const fixture = (name: string): Promise<Uint8Array> => readFile(resolve('tests/fixtures', name)).then((b) => new Uint8Array(b));
const pdfPage = (sourceId: string, pageIndex: number): PageModel => ({
  id: `${sourceId}-${pageIndex}`,
  source: { kind: 'pdf', sourceId, pageIndex },
  box: { x: 0, y: 0, width: 595, height: 842 },
  rotation: 0,
});

/** Opens a file with an independent parser; resolves with the text of page 1 and whether it is encrypted. */
async function read(bytes: Uint8Array, password?: string): Promise<{ text: string[]; encrypted: boolean; pages: number }> {
  const document = await getDocument({ data: bytes.slice(), password, disableFontFace: true }).promise;
  const content = await (await document.getPage(1)).getTextContent();
  const result = {
    text: content.items.flatMap((item) => ('str' in item && item.str.trim() ? [item.str] : [])),
    encrypted: (await document.getPermissions()) !== null,
    pages: document.numPages,
  };
  await document.loadingTask.destroy();
  return result;
}

const failure = (promise: Promise<unknown>): Promise<string> =>
  promise.then(
    () => 'ok',
    (error: unknown) => (error instanceof ExportError ? error.code : error instanceof Error ? error.name : 'other'),
  );

describe('password protection', () => {
  it('encrypts the output so that it opens only with the password', async () => {
    const mixed = await fixture('mixed-pages.pdf');
    const plain = await read(mixed);
    const bytes = await buildPdf({ pages: [pdfPage('m', 0), pdfPage('m', 1)], sources: { m: mixed }, assets: {}, password: 'пароль-1' });

    // The page text is not readable in the file itself.
    expect(Buffer.from(bytes).includes(Buffer.from(plain.text[0]!))).toBe(false);
    expect(Buffer.from(bytes).toString('latin1')).toContain('/Encrypt');
    expect(await failure(read(bytes))).toBe('PasswordException');
    expect(await failure(read(bytes, 'wrong'))).toBe('PasswordException');
    expect(await read(bytes, 'пароль-1')).toEqual({ text: plain.text, encrypted: true, pages: 2 });
  });

  it('reads a protected source with its password and can save it protected or open', async () => {
    const encrypted = await fixture('encrypted.pdf');
    const original = await read(encrypted, 'secret');
    expect(original.encrypted).toBe(true);
    const input = { pages: [pdfPage('e', 0)], sources: { e: encrypted }, assets: {} };

    // Without the password, or with a wrong one, nothing is written.
    expect(await failure(buildPdf(input))).toBe('encryptedSource');
    expect(await failure(buildPdf({ ...input, sourcePasswords: { e: 'nope' } }))).toBe('encryptedSource');

    const kept = await buildPdf({ ...input, sourcePasswords: { e: 'secret' }, password: 'secret' });
    expect(await failure(read(kept))).toBe('PasswordException');
    expect(await read(kept, 'secret')).toEqual({ text: original.text, encrypted: true, pages: 1 });

    const opened = await buildPdf({ ...input, sourcePasswords: { e: 'secret' } });
    expect(await read(opened)).toEqual({ text: original.text, encrypted: false, pages: 1 });
  });
});
