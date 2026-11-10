import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PDFDocument, PDFName, PDFDict } from '@cantoo/pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { fontFileName } from '@shared/fonts';
import type { Bookmark, PageModel } from '@shared/types/document';
import type { EditorObject, PathObject, ShapeObject, TextObject } from '@shared/types/objects';
import { buildPdf, type ExportInput } from '@renderer/engine/export/buildPdf';
import { localToPdfMatrix } from '@renderer/engine/export/drawObjects';
import { toExportBookmarks } from '@renderer/engine/export/outline';
import { layoutText } from '@renderer/engine/objects/textLayout';

const read = (path: string): Promise<Uint8Array> => readFile(resolve(path)).then((buffer) => new Uint8Array(buffer));
const font = (name: string): Promise<Uint8Array> => read(`node_modules/dejavu-fonts-ttf/ttf/${name}`);

const base = { rotation: 0, opacity: 1, layerId: 'layer' };
const text = (patch: Partial<TextObject>): TextObject => ({
  ...base,
  id: 't',
  type: 'text',
  x: 50,
  y: 60,
  width: 400,
  height: 30,
  text: '',
  fontFamily: 'sans',
  fontSize: 16,
  bold: false,
  italic: false,
  color: '#102030',
  align: 'left',
  lineHeight: 1.2,
  background: null,
  replacesOriginal: false,
  ...patch,
});
const shape = (patch: Partial<ShapeObject>): ShapeObject => ({
  ...base,
  id: 's',
  type: 'shape',
  shape: 'rect',
  x: 100,
  y: 100,
  width: 200,
  height: 100,
  stroke: '#ff0000',
  strokeWidth: 3,
  fill: null,
  dashed: false,
  flipped: false,
  ...patch,
});

let mixed: Uint8Array;
const blankPage: PageModel = { id: 'blank', source: { kind: 'blank' }, box: { x: 0, y: 0, width: 600, height: 800 }, rotation: 0 };
const pdfPage: PageModel = { id: 'pdf', source: { kind: 'pdf', sourceId: 'mixed', pageIndex: 0 }, box: { x: 0, y: 0, width: 595.28, height: 841.89 }, rotation: 0 };

async function exportWith(page: PageModel, objects: EditorObject[]): Promise<Uint8Array> {
  const input: ExportInput = { pages: [page], sources: { mixed }, assets: {}, objects: { [page.id]: objects }, fonts: {}, textLines: {} };
  for (const object of objects) {
    if (object.type !== 'text') continue;
    input.textLines![object.id] = layoutText(object).lines;
    const file = fontFileName(object.fontFamily, object);
    input.fonts![file] = await font(file);
  }
  return buildPdf(input);
}

/** Text and operator names of the first page, read back with an independent parser (PDF.js). */
async function inspect(bytes: Uint8Array) {
  const document = await getDocument({ data: bytes.slice(), useSystemFonts: false, disableFontFace: true }).promise;
  const page = await document.getPage(1);
  const content = await page.getTextContent();
  const operators = await page.getOperatorList();
  const result = {
    items: content.items.flatMap((item) => ('str' in item && item.str.trim() ? [{ str: item.str, x: item.transform[4] as number, y: item.transform[5] as number }] : [])),
    operatorCount: operators.fnArray.length,
  };
  await document.loadingTask.destroy();
  return result;
}

/** Number of distinct font objects the first page refers to (one font may have several resource names). */
async function embeddedFontCount(bytes: Uint8Array): Promise<number> {
  const fonts = (await PDFDocument.load(bytes)).getPages()[0]!.node.Resources()?.lookup(PDFName.of('Font'));
  return fonts instanceof PDFDict ? new Set(fonts.values().map(String)).size : 0;
}

beforeAll(async () => {
  mixed = await read('tests/fixtures/mixed-pages.pdf');
});

describe('exporting objects', () => {
  it('writes Russian, Ukrainian and English text as real, extractable text', async () => {
    const object = text({ text: 'Привет, мир!\nПривіт, їжак і ґанок — єдність.\nHello, world!' });
    const bytes = await exportWith(blankPage, [{ ...object, height: layoutText(object).height }]);
    const { items } = await inspect(bytes);
    expect(items.map((item) => item.str)).toEqual(['Привет, мир!', 'Привіт, їжак і ґанок — єдність.', 'Hello, world!']);

    // Baselines sit exactly where the layout put them: page height - (y + baseline).
    const layout = layoutText(object);
    items.forEach((item, index) => {
      expect(item.x).toBeCloseTo(object.x + layout.lines[index]!.x, 3);
      expect(item.y).toBeCloseTo(800 - (object.y + layout.lines[index]!.baseline), 3);
    });

    // The font is embedded as a subset, not as the whole 750 kB file.
    expect(bytes.length).toBeLessThan(40_000);
    expect(await embeddedFontCount(bytes)).toBe(1);
  });

  it('embeds each font variant that is used', async () => {
    const bytes = await exportWith(blankPage, [
      text({ id: 'a', text: 'Regular' }),
      text({ id: 'b', y: 100, text: 'Жирный курсив', bold: true, italic: true, fontFamily: 'serif' }),
      text({ id: 'c', y: 140, text: 'mono', fontFamily: 'mono' }),
    ]);
    const { items } = await inspect(bytes);
    expect(items.map((item) => item.str)).toEqual(['Regular', 'Жирный курсив', 'mono']);
    expect(await embeddedFontCount(bytes)).toBe(3);
  });

  it('draws on top of an existing page without disturbing its own text', async () => {
    const bytes = await exportWith(pdfPage, [text({ text: 'Добавлено' }), shape({})]);
    const { items } = await inspect(bytes);
    expect(items.map((item) => item.str)).toEqual(['Page 1 - A4 portrait', 'Добавлено']);
    // Still vector: no image XObjects were created for our drawing.
    const xobjects = (await PDFDocument.load(bytes)).getPages()[0]!.node.Resources()?.lookup(PDFName.of('XObject'));
    expect(!(xobjects instanceof PDFDict) || xobjects.keys().length === 0).toBe(true);
  });

  it('exports shapes, lines, arrows and freehand paths as vector operators', async () => {
    const path: PathObject = { ...base, id: 'p', type: 'path', x: 10, y: 10, width: 100, height: 50, points: [0, 0, 0.5, 1, 1, 0], stroke: '#00aa00', strokeWidth: 4, highlighter: true, opacity: 0.4 };
    const empty = await inspect(await exportWith(blankPage, []));
    const drawn = await inspect(
      await exportWith(blankPage, [
        shape({ id: 'r', fill: '#ffee00', dashed: true }),
        shape({ id: 'e', shape: 'ellipse', rotation: 30, opacity: 0.5 }),
        shape({ id: 'l', shape: 'line', flipped: true }),
        shape({ id: 'a', shape: 'arrow' }),
        path,
      ]),
    );
    expect(empty.operatorCount).toBe(0);
    expect(drawn.operatorCount).toBeGreaterThan(20);
  });

  it('maps object-local coordinates to PDF space, including rotation', () => {
    const box = { x: 10, y: 20, width: 600, height: 800 };
    const apply = (m: number[], x: number, y: number) => [m[0]! * x + m[2]! * y + m[4]!, m[1]! * x + m[3]! * y + m[5]!];
    const plain = shape({ x: 100, y: 50, width: 200, height: 100 });
    // Top-left corner of the object: 100 right of the box, 50 below its top edge.
    expect(apply(localToPdfMatrix(plain, box), 0, 0)).toEqual([110, 770]);
    expect(apply(localToPdfMatrix(plain, box), 200, 100)).toEqual([310, 670]);

    // Rotated 90° clockwise about its centre (200, 100): the local top-left corner moves to the top-right.
    const turned = localToPdfMatrix({ ...plain, rotation: 90 }, box);
    const [x, y] = apply(turned, 0, 0);
    expect(x).toBeCloseTo(10 + 250, 9);
    expect(y).toBeCloseTo(820 - 0, 9);
    const [x2, y2] = apply(turned, 200, 100);
    expect(x2).toBeCloseTo(10 + 150, 9);
    expect(y2).toBeCloseTo(820 - 200, 9);
  });

  it('writes layers as optional content groups with their visibility, lock state and opacity', async () => {
    const onLayer = (id: string, layerId: string, value: string, y: number): TextObject => text({ id, layerId, text: value, y });
    const objects = [onLayer('a', 'notes', 'Visible note', 100), onLayer('b', 'draft', 'Hidden draft', 200), onLayer('c', 'notes', 'Second note', 300)];
    const input: ExportInput = {
      pages: [blankPage],
      sources: {},
      assets: {},
      objects: { [blankPage.id]: objects },
      layers: {
        [blankPage.id]: [
          { id: 'draft', name: 'Черновик', visible: false, locked: false, opacity: 1 },
          { id: 'notes', name: 'Notes', visible: true, locked: true, opacity: 0.5 },
          { id: 'empty', name: 'Empty', visible: true, locked: false, opacity: 1 },
        ],
      },
      fonts: { 'DejaVuSans.ttf': await font('DejaVuSans.ttf') },
      textLines: Object.fromEntries(objects.map((item) => [item.id, layoutText(item).lines])),
    };
    const bytes = await buildPdf(input);

    // Read the layer configuration back with PDF.js, as a PDF reader would.
    const document = await getDocument({ data: bytes.slice(), disableFontFace: true }).promise;
    const config = await document.getOptionalContentConfig();
    const groups = Object.fromEntries(
      [...config].map(([id, group]) => [(group as { name: string }).name, config.isVisible({ type: 'OCG', id })]),
    );
    // Empty layers are not written; names survive, including Cyrillic ones.
    expect(groups).toEqual({ Черновик: false, Notes: true });

    const page = await document.getPage(1);
    const content = await page.getTextContent();
    const lines = content.items.flatMap((item) => ('str' in item && item.str.trim() ? [item.str] : []));
    // Layer order: the draft layer is below the notes layer, so it is written first.
    expect(lines).toEqual(['Hidden draft', 'Visible note', 'Second note']);
    await document.loadingTask.destroy();

    // Catalog entries: hidden layers are OFF, locked layers are listed as locked.
    const saved = await PDFDocument.load(bytes);
    const properties = saved.catalog.lookup(PDFName.of('OCProperties'), PDFDict);
    const defaults = properties.lookup(PDFName.of('D'), PDFDict);
    const size = (key: string): number => (defaults.lookup(PDFName.of(key)) as unknown as { size(): number }).size();
    expect(size('OFF')).toBe(1);
    expect(size('Locked')).toBe(1);
    expect(size('Order')).toBe(2);
  });

  it('writes no layer structures when a page has no layers', async () => {
    const bytes = await exportWith(blankPage, [shape({})]);
    const saved = await PDFDocument.load(bytes);
    expect(saved.catalog.lookup(PDFName.of('OCProperties'))).toBeUndefined();
  });

  it('writes bookmarks as a nested outline that points at the right pages', async () => {
    const pages = [0, 1, 2].map((index) => ({ ...blankPage, id: `p${index}` }));
    const bytes = await buildPdf({
      pages,
      sources: {},
      assets: {},
      bookmarks: [
        { title: 'Глава 1', pageIndex: 0, children: [{ title: 'Раздел 1.1', pageIndex: 1, children: [] }] },
        { title: 'Chapter 2', pageIndex: 2, children: [] },
        { title: 'Group without a page', pageIndex: null, children: [{ title: 'Inside', pageIndex: 0, children: [] }] },
      ],
    });
    const document = await getDocument({ data: bytes.slice(), disableFontFace: true }).promise;
    const outline = (await document.getOutline())!;
    type Node = { title: string; dest: unknown[] | null; items: Node[] };
    const describeNode = async (node: Node): Promise<unknown> => ({
      title: node.title,
      page: node.dest ? await document.getPageIndex(node.dest[0] as never) : null,
      children: await Promise.all(node.items.map(describeNode)),
    });
    expect(await Promise.all((outline as Node[]).map(describeNode))).toEqual([
      { title: 'Глава 1', page: 0, children: [{ title: 'Раздел 1.1', page: 1, children: [] }] },
      { title: 'Chapter 2', page: 2, children: [] },
      { title: 'Group without a page', page: null, children: [{ title: 'Inside', page: 0, children: [] }] },
    ]);
    await document.loadingTask.destroy();
  });

  it('resolves bookmark pages for export and drops entries that lead nowhere', () => {
    const mark = (title: string, pageId: string | null, children: Bookmark[] = []): Bookmark => ({ id: title, title, pageId, children });
    const positions = new Map([['a', 0], ['c', 1]]);
    expect(
      toExportBookmarks(
        [mark('A', 'a'), mark('Deleted page', 'b'), mark('Group', null, [mark('C', 'c'), mark('Gone', 'zz')]), mark('Empty group', null, [mark('Gone too', 'b')])],
        positions,
      ),
    ).toEqual([
      { title: 'A', pageIndex: 0, children: [] },
      { title: 'Group', pageIndex: null, children: [{ title: 'C', pageIndex: 1, children: [] }] },
    ]);
  });

  it('writes OCR text as an invisible layer that readers can find, select and extract', async () => {
    const lines = [
      { text: 'Скан: распознанный текст', x: 60, baseline: 120, angle: 0, width: 300, fontSize: 14, fontFamily: 'sans' as const },
      // Text of a page that is displayed rotated runs "upwards" in unrotated page space.
      { text: 'Rotated line', x: 500, baseline: 700, angle: 270, width: 200, fontSize: 12, fontFamily: 'sans' as const },
    ];
    const withText = await buildPdf({
      pages: [blankPage],
      sources: {},
      assets: {},
      hiddenText: { [blankPage.id]: lines },
      fonts: { 'DejaVuSans.ttf': await font('DejaVuSans.ttf') },
    });

    const document = await getDocument({ data: withText.slice(), disableFontFace: true }).promise;
    const page = await document.getPage(1);
    const content = await page.getTextContent();
    const items = content.items.flatMap((item) => ('str' in item && item.str.trim() ? [item] : []));
    // (A reader may hand the words of a line back separately.)
    expect(items.map((item) => item.str).join(' ')).toBe('Скан: распознанный текст Rotated line');
    // Position and width match the recognised area (the glyphs are stretched to fit it).
    const first = items[0];
    const rotated = items.filter((item) => item !== first);
    const second = rotated[0];
    expect(first!.transform[4]).toBeCloseTo(60, 3);
    expect(first!.transform[5]).toBeCloseTo(800 - 120, 3);
    expect(first!.width).toBeCloseTo(300, 0);
    // 270° clockwise on the page is 90° counter-clockwise in PDF space: the x axis of the text points up.
    expect(second!.transform[0]).toBeCloseTo(0, 6);
    expect(second!.transform[1]).toBeGreaterThan(0);
    const rotatedLength = rotated.at(-1)!.transform[5] + rotated.at(-1)!.width - second!.transform[5];
    expect(rotatedLength).toBeCloseTo(200, 0);

    // Nothing is painted: the operator list has text, but no fill or stroke colour is ever needed,
    // and the page renders exactly like an empty one.
    const operators = await page.getOperatorList();
    const { OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const modes = operators.fnArray.flatMap((fn, index) => (fn === OPS.setTextRenderingMode ? [operators.argsArray[index]![0]] : []));
    expect(modes.length).toBeGreaterThan(0);
    expect(modes.every((mode) => mode === 3)).toBe(true);
    await document.loadingTask.destroy();
  });

  it('does not need a font when there is no recognised text', async () => {
    const bytes = await buildPdf({ pages: [blankPage], sources: {}, assets: {}, hiddenText: { [blankPage.id]: [] } });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});
