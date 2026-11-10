import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PDFDict, PDFDocument, PDFName, type PDFPage } from '@cantoo/pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PageModel, PageRotation } from '@shared/types/document';
import { buildPdf, ExportError } from '@renderer/engine/export/buildPdf';

const fixture = (name: string): Promise<Uint8Array> => readFile(resolve('tests/fixtures', name)).then((b) => new Uint8Array(b));
// 1x1 red PNG.
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

let mixed: Uint8Array;
let many: Uint8Array;
let id = 0;
const pdfPage = (sourceId: string, pageIndex: number, rotation: PageRotation = 0): PageModel => ({
  id: `p${(id += 1)}`,
  source: { kind: 'pdf', sourceId, pageIndex },
  box: { x: 0, y: 0, width: 1, height: 1 },
  rotation,
});

beforeAll(async () => {
  mixed = await fixture('mixed-pages.pdf');
  many = await fixture('many-pages.pdf');
});

/** Whether the page's resource dictionary has at least one entry of the given kind. */
const hasResource = (page: PDFPage, kind: string): boolean => {
  const entry = page.node.Resources()?.lookup(PDFName.of(kind));
  return entry instanceof PDFDict && entry.keys().length > 0;
};

const describePages = async (bytes: Uint8Array) =>
  (await PDFDocument.load(bytes)).getPages().map((page) => ({
    width: Math.round(page.getWidth()),
    height: Math.round(page.getHeight()),
    rotation: page.getRotation().angle,
    hasFont: hasResource(page, 'Font'),
    hasImage: hasResource(page, 'XObject'),
  }));

describe('buildPdf', () => {
  it('reorders, rotates and mixes pages from several sources', async () => {
    const bytes = await buildPdf({
      pages: [pdfPage('many', 9), pdfPage('mixed', 1, 90), pdfPage('mixed', 0), pdfPage('mixed', 2, 0)],
      sources: { mixed, many },
      assets: {},
    });
    expect(await describePages(bytes)).toEqual([
      { width: 595, height: 842, rotation: 0, hasFont: true, hasImage: false },
      { width: 792, height: 612, rotation: 90, hasFont: true, hasImage: false },
      { width: 595, height: 842, rotation: 0, hasFont: true, hasImage: false },
      // The source page had /Rotate 90; the model says 0, and the model wins.
      { width: 595, height: 842, rotation: 0, hasFont: true, hasImage: false },
    ]);
  });

  it('keeps original text as text (no rasterisation)', async () => {
    const bytes = await buildPdf({ pages: [pdfPage('mixed', 0)], sources: { mixed }, assets: {} });
    const [page] = (await PDFDocument.load(bytes)).getPages();
    const content = page!.node.Contents();
    expect(content).toBeDefined();
    const resources = await describePages(bytes);
    expect(resources[0]).toMatchObject({ hasFont: true, hasImage: false });
    // A one-page text document stays tiny; a rasterised page would be far larger.
    expect(bytes.length).toBeLessThan(5_000);
  });

  it('writes duplicated pages as independent pages', async () => {
    const bytes = await buildPdf({
      pages: [pdfPage('mixed', 0), pdfPage('mixed', 0, 180), pdfPage('mixed', 0, 90)],
      sources: { mixed },
      assets: {},
    });
    const document = await PDFDocument.load(bytes);
    expect(document.getPages().map((page) => page.getRotation().angle)).toEqual([0, 180, 90]);
    expect(new Set(document.getPages().map((page) => page.ref.toString())).size).toBe(3);
  });

  it('adds blank pages and image pages of the requested size', async () => {
    const box = { x: 0, y: 0, width: 300, height: 150 };
    const bytes = await buildPdf({
      pages: [
        { id: 'blank', source: { kind: 'blank' }, box, rotation: 0 },
        { id: 'image', source: { kind: 'image', assetId: 'a' }, box, rotation: 90 },
        { id: 'image2', source: { kind: 'image', assetId: 'a' }, box, rotation: 0 },
        pdfPage('mixed', 0),
      ],
      sources: { mixed },
      assets: { a: { bytes: PNG, mime: 'image/png' } },
    });
    expect(await describePages(bytes)).toEqual([
      { width: 300, height: 150, rotation: 0, hasFont: false, hasImage: false },
      { width: 300, height: 150, rotation: 90, hasFont: false, hasImage: true },
      { width: 300, height: 150, rotation: 0, hasFont: false, hasImage: true },
      { width: 595, height: 842, rotation: 0, hasFont: true, hasImage: false },
    ]);
  });

  it('handles a 60-page document and preserves the source title', async () => {
    const pages = Array.from({ length: 60 }, (_, index) => pdfPage('many', 59 - index));
    const bytes = await buildPdf({ pages, sources: { many }, assets: {} });
    // (Loading with default options would overwrite the producer with pdf-lib's own.)
    const document = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(document.getPageCount()).toBe(60);
    expect(document.getTitle()).toBe('Many pages');
    expect(document.getProducer()).toBe('PDF Editor');
  });

  it('fails clearly instead of writing a broken file', async () => {
    const code = (promise: Promise<unknown>) =>
      promise.then(
        () => 'ok',
        (error: unknown) => (error instanceof ExportError ? error.code : 'other'),
      );
    const encrypted = await fixture('encrypted.pdf');
    expect(await code(buildPdf({ pages: [pdfPage('e', 0)], sources: { e: encrypted }, assets: {} }))).toBe('encryptedSource');
    expect(await code(buildPdf({ pages: [pdfPage('gone', 0)], sources: {}, assets: {} }))).toBe('missingResource');
    expect(await code(buildPdf({ pages: [pdfPage('mixed', 7)], sources: { mixed }, assets: {} }))).toBe('missingResource');
    expect(
      await code(
        buildPdf({
          pages: [{ id: 'i', source: { kind: 'image', assetId: 'x' }, box: { x: 0, y: 0, width: 1, height: 1 }, rotation: 0 }],
          sources: {},
          assets: {},
        }),
      ),
    ).toBe('missingResource');
  });
});
