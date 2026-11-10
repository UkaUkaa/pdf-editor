import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PDFDict, PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { fontKey } from '@shared/fonts';
import type { PageModel } from '@shared/types/document';
import type { TextObject } from '@shared/types/objects';
import { buildPdf } from '@renderer/engine/export/buildPdf';
import { SystemFontCatalogue } from '../../../src/main/services/systemFonts';

const page: PageModel = { id: 'p', source: { kind: 'blank' }, box: { x: 0, y: 0, width: 595, height: 842 }, rotation: 0 };
const text = (id: string, fontFamily: string, value: string, bold = false, italic = false): TextObject => ({
  id,
  layerId: 'l',
  type: 'text',
  x: 50,
  y: 50 + Number(id) * 40,
  width: 400,
  height: 30,
  rotation: 0,
  opacity: 1,
  text: value,
  fontFamily,
  fontSize: 14,
  bold,
  italic,
  color: '#000000',
  align: 'left',
  lineHeight: 1.2,
  background: null,
  replacesOriginal: false,
});

/** Text of page 1 as an independent parser reads it, and the names of the fonts embedded in the file. */
async function fontsOf(bytes: Uint8Array): Promise<{ strings: string[]; fonts: string[] }> {
  const document = await getDocument({ data: bytes.slice(), disableFontFace: true }).promise;
  const content = await (await document.getPage(1)).getTextContent();
  const strings = content.items.flatMap((item) => ('str' in item && item.str.trim() ? [item.str] : []));
  await document.loadingTask.destroy();

  const parsed = await PDFDocument.load(bytes, { updateMetadata: false });
  const names = new Set<string>();
  for (const [, object] of parsed.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict) || object.get(PDFName.of('Type')) !== PDFName.of('Font')) continue;
    const base = object.get(PDFName.of('BaseFont'));
    // Subset fonts carry a six-letter tag in front of the name.
    if (base instanceof PDFName) names.add(base.decodeText().replace(/^[A-Z]{6}\+/, '').replace(/-\d+$/, ''));
  }
  return { strings, fonts: [...names].sort() };
}

describe('exporting text in fonts installed on the computer', () => {
  it('embeds a font under its system key, with Cyrillic text', async () => {
    // Stands in for an installed font on any platform: the key is what matters to the exporter.
    const bytes = new Uint8Array(await readFile(resolve('node_modules/dejavu-fonts-ttf/ttf/DejaVuSerif-Italic.ttf')));
    const object = text('1', 'Some Installed Font', 'Привет, world', false, true);
    const pdf = await buildPdf({
      pages: [page],
      sources: {},
      assets: {},
      objects: { p: [object] },
      fonts: { [fontKey(object.fontFamily, object)]: bytes },
      textLines: { '1': [{ text: object.text, x: 2, baseline: 16 }] },
    });
    expect(await fontsOf(pdf)).toEqual({ strings: ['Привет, world'], fonts: ['DejaVuSerif-Italic'] });
  });

  it.runIf(process.platform === 'darwin')('embeds real system fonts: Times New Roman, Arial, Courier New, Georgia and a collection face', async () => {
    const catalogue = new SystemFontCatalogue();
    const installed = new Set((await catalogue.list()).map((family) => family.family));
    const wanted: Array<[family: string, bold: boolean, italic: boolean]> = [
      ['Times New Roman', false, false],
      ['Times New Roman', true, true],
      ['Arial', true, false],
      ['Courier New', false, false],
      ['Georgia', false, true],
      ['Helvetica', false, false],
    ];
    const used = wanted.filter(([family]) => installed.has(family));
    expect(used.map(([family]) => family)).toContain('Times New Roman');

    const objects = used.map(([family, bold, italic], index) => text(String(index), family, `${family} — Привет, світ`, bold, italic));
    const fonts: Record<string, Uint8Array> = {};
    for (const object of objects) {
      fonts[fontKey(object.fontFamily, object)] = (await catalogue.read({ family: object.fontFamily, bold: object.bold, italic: object.italic }))!;
    }
    const pdf = await buildPdf({
      pages: [page],
      sources: {},
      assets: {},
      objects: { p: objects },
      fonts,
      textLines: Object.fromEntries(objects.map((object) => [object.id, [{ text: object.text, x: 2, baseline: 16 }]])),
    });

    const result = await fontsOf(pdf);
    // (A parser may report the words of a monospaced line one by one.)
    expect(result.strings.join(' ')).toBe(objects.map((object) => object.text).join(' '));
    expect(result.fonts).toEqual(expect.arrayContaining(['TimesNewRomanPSMT', 'TimesNewRomanPS-BoldItalicMT', 'Arial-BoldMT', 'CourierNewPSMT', 'Georgia-Italic']));
    // Fonts are reduced to the glyphs in use where possible; Courier New cannot be and is embedded whole.
    expect(pdf.length).toBeLessThan(1_500_000);
  });
});
