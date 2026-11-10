import { PDFDocument } from '@cantoo/pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import type { PageModel } from '@shared/types/document';
import type { LinkObject, NoteObject } from '@shared/types/objects';
import { safeExternalUrl } from '@shared/utils/externalUrl';
import { pdfDate } from '@renderer/engine/export/annotations';
import { buildPdf } from '@renderer/engine/export/buildPdf';
import { importAnnotations, parsePdfDate } from '@renderer/engine/pdf/importAnnotations';
import type { SourceAnnotation } from '@renderer/engine/pdf/sourceTypes';

const page = (id: string): PageModel => ({ id, source: { kind: 'blank' }, box: { x: 0, y: 0, width: 600, height: 800 }, rotation: 0 });
const base = { layerId: 'l', rotation: 0, opacity: 1 };
const note = (patch: Partial<NoteObject> = {}): NoteObject => ({
  ...base,
  id: 'n1',
  type: 'note',
  x: 100,
  y: 50,
  width: 20,
  height: 20,
  text: 'Проверить цифры',
  author: 'Олена',
  createdAt: '2026-03-04T05:06:07.000Z',
  replies: [{ id: 'r1', text: 'Done', author: 'Bob', createdAt: '2026-03-05T00:00:00.000Z' }],
  color: '#ffd60a',
  ...patch,
});
const link = (id: string, target: LinkObject['target'], y: number): LinkObject => ({ ...base, id, type: 'link', x: 10, y, width: 200, height: 20, target });

type RawAnnotation = { id: string; subtype: string; rect: number[]; contentsObj?: { str: string }; titleObj?: { str: string }; inReplyTo?: string; url?: string; dest?: unknown[] };

async function read(bytes: Uint8Array) {
  const document = await getDocument({ data: bytes.slice(), disableFontFace: true }).promise;
  const first = await document.getPage(1);
  const annotations = (await first.getAnnotations({ intent: 'any' })) as RawAnnotation[];
  const attachments = await document.getAttachments();
  return { document, annotations, attachments };
}

describe('writing annotations', () => {
  it('writes notes with author, date and replies, and links to addresses and pages', async () => {
    const bytes = await buildPdf({
      pages: [page('a'), page('b')],
      sources: {},
      assets: {},
      objects: {
        a: [
          note(),
          link('web', { kind: 'url', url: 'https://example.com/a?b=1' }, 700),
          link('jump', { kind: 'page', pageId: 'b' }, 730),
          // Unsafe or empty targets are never written.
          link('bad', { kind: 'url', url: 'javascript:alert(1)' }, 760),
          link('empty', { kind: 'url', url: '' }, 780),
        ],
      },
    });
    const { document, annotations } = await read(bytes);
    const texts = annotations.filter((item) => item.subtype === 'Text');
    expect(texts.map((item) => [item.contentsObj?.str, item.titleObj?.str])).toEqual([
      ['Проверить цифры', 'Олена'],
      ['Done', 'Bob'],
    ]);
    // The reply refers to the note; both sit where the note is (PDF y grows upwards).
    expect(texts[1]!.inReplyTo).toBe(texts[0]!.id);
    // (Readers draw the icon at their own size, anchored at the top-left corner.)
    expect(texts[0]!.rect[0]).toBe(100);
    expect(texts[0]!.rect[3]).toBe(750);

    const links = annotations.filter((item) => item.subtype === 'Link');
    expect(links).toHaveLength(2);
    expect(links[0]!.url).toBe('https://example.com/a?b=1');
    expect(await document.getPageIndex(links[1]!.dest![0] as never)).toBe(1);
    await document.loadingTask.destroy();
  });

  it('leaves out annotations on hidden layers and embeds attachments', async () => {
    const bytes = await buildPdf({
      pages: [page('a')],
      sources: {},
      assets: {},
      objects: { a: [note({ layerId: 'hidden' }), note({ id: 'n2', layerId: 'shown', text: 'Visible', replies: [] })] },
      layers: {
        a: [
          { id: 'hidden', name: 'Hidden', visible: false, locked: false, opacity: 1 },
          { id: 'shown', name: 'Shown', visible: true, locked: false, opacity: 1 },
        ],
      },
      attachments: [{ name: 'данные.csv', bytes: new TextEncoder().encode('a,b\n') }],
    });
    const { document, annotations, attachments } = await read(bytes);
    expect(annotations.filter((item) => item.subtype === 'Text').map((item) => item.contentsObj?.str)).toEqual(['Visible']);
    const names = attachments instanceof Map ? [...attachments.keys()] : Object.keys(attachments ?? {});
    expect(names).toEqual(['данные.csv']);
    await document.loadingTask.destroy();
  });

  it('does not write taken-over annotations of the source twice, but keeps the others', async () => {
    // A source file with two comments and a link.
    const source = await buildPdf({
      pages: [page('a')],
      sources: {},
      assets: {},
      objects: { a: [note({ replies: [] }), note({ id: 'n2', text: 'Keep me', replies: [] }), link('web', { kind: 'url', url: 'https://example.com' }, 700)] },
    });
    const original = await read(source);
    const number = (id: string): number => Number(/^(\d+)R/.exec(id)![1]);
    const [first, second] = original.annotations.filter((item) => item.subtype === 'Text');
    await original.document.loadingTask.destroy();

    // The editor took over the first comment (and edited it); the second one was not taken.
    const sourcePage: PageModel = { id: 'p', source: { kind: 'pdf', sourceId: 's', pageIndex: 0 }, box: { x: 0, y: 0, width: 600, height: 800 }, rotation: 0 };
    const saved = await buildPdf({
      pages: [sourcePage],
      sources: { s: source },
      assets: {},
      objects: { p: [note({ text: 'Edited', replies: [] })] },
      takenAnnotations: { s: { 0: [number(first!.id)] } },
    });
    const result = await read(saved);
    expect(result.annotations.filter((item) => item.subtype === 'Text').map((item) => item.contentsObj?.str).sort()).toEqual(['Edited', 'Keep me']);
    expect(result.annotations.filter((item) => item.subtype === 'Link')).toHaveLength(1);
    expect(second).toBeDefined();
    await result.document.loadingTask.destroy();
    // The file is still a valid PDF for pdf-lib as well.
    expect((await PDFDocument.load(saved)).getPageCount()).toBe(1);
  });
});

describe('reading annotations', () => {
  const geometry = { x: 10, y: 20, width: 18, height: 18 };

  it('builds notes with their replies and only safe links', () => {
    const annotations: SourceAnnotation[] = [
      { ...geometry, kind: 'note', objectNumber: 5, text: 'Question', author: 'Ann', modified: "D:20260102030405+02'00'", color: '#00ff00', inReplyTo: null },
      { ...geometry, kind: 'note', objectNumber: 6, text: 'Answer', author: 'Bo', modified: 'D:20260103', color: null, inReplyTo: 5 },
      { ...geometry, kind: 'note', objectNumber: 7, text: 'Orphan reply', author: '', modified: '', color: null, inReplyTo: 99 },
      { ...geometry, kind: 'link', objectNumber: 8, width: 100, url: 'https://example.com', pageIndex: null },
      { ...geometry, kind: 'link', objectNumber: 9, width: 100, url: null, pageIndex: 2 },
      { ...geometry, kind: 'link', objectNumber: 10, width: 100, url: 'file:///etc/passwd', pageIndex: null },
      { ...geometry, kind: 'link', objectNumber: 11, width: 100, url: null, pageIndex: 50 },
    ];
    let next = 0;
    const result = importAnnotations(annotations, (index) => (index < 5 ? `page${index}` : null), () => `id${(next += 1)}`, 'Annotations');
    expect(result.layer).toMatchObject({ name: 'Annotations', type: 'annotation' });
    expect(result.objects.map((object) => object.type)).toEqual(['note', 'link', 'link']);
    const [first, web, jump] = result.objects as [NoteObject, LinkObject, LinkObject];
    expect(first).toMatchObject({ text: 'Question', author: 'Ann', color: '#00ff00', createdAt: '2026-01-02T01:04:05.000Z', width: 20, x: 10 });
    expect(first.replies).toEqual([expect.objectContaining({ text: 'Answer', author: 'Bo', createdAt: '2026-01-03T00:00:00.000Z' })]);
    expect(web.target).toEqual({ kind: 'url', url: 'https://example.com/' });
    expect(jump.target).toEqual({ kind: 'page', pageId: 'page2' });
    // Only what became an object is taken over; unsafe links and orphans stay in the file as they are.
    expect(result.taken).toEqual([5, 6, 8, 9]);
    expect(importAnnotations([], () => null, () => 'x', 'A')).toEqual({ objects: [], layer: null, taken: [] });
  });

  it('converts dates both ways', () => {
    expect(parsePdfDate("D:20260102030405-05'00'")).toBe('2026-01-02T08:04:05.000Z');
    expect(parsePdfDate('D:2026')).toBe('2026-01-01T00:00:00.000Z');
    expect(parsePdfDate('garbage', 'fallback')).toBe('fallback');
    expect(pdfDate('2026-03-04T05:06:07.000Z')).toBe('D:20260304050607Z');
    expect(parsePdfDate(pdfDate('2026-12-31T23:59:59.000Z'))).toBe('2026-12-31T23:59:59.000Z');
  });
});

describe('safeExternalUrl', () => {
  it('accepts web and mail addresses and completes bare domains', () => {
    expect(safeExternalUrl('https://example.com/a b')).toBeNull();
    expect(safeExternalUrl(' https://example.com/path?q=1 ')).toBe('https://example.com/path?q=1');
    expect(safeExternalUrl('example.com/page')).toBe('https://example.com/page');
    expect(safeExternalUrl('http://localhost:8080')).toBe('http://localhost:8080/');
    expect(safeExternalUrl('mailto:someone@example.com')).toBe('mailto:someone@example.com');
  });

  it('refuses everything that could run or reveal something', () => {
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,<script>', 'vbscript:x', 'smb://server/share', 'ms-settings:', '', '   ', 'http://', 'notadomain', `https://example.com/${'a'.repeat(3000)}`]) {
      expect(safeExternalUrl(url), url).toBeNull();
    }
  });
});
