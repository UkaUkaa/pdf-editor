import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as fontkit from '@cantoo/fontkit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractFace, readFontFaces, SystemFontCatalogue, systemFontDirectories } from '../../../src/main/services/systemFonts';

const DEJAVU = resolve('node_modules/dejavu-fonts-ttf/ttf');
const readerOf = (data: Buffer) => async (position: number, length: number) =>
  position >= 0 && length >= 0 && position + length <= data.length ? data.subarray(position, position + length) : null;

/** Packs single-face fonts into a TrueType collection, the way system .ttc files are built. */
function makeCollection(fonts: Buffer[]): Buffer {
  const headerSize = 12 + fonts.length * 4;
  const parts: Buffer[] = [];
  const offsets: number[] = [];
  let position = headerSize;
  for (const font of fonts) {
    const count = font.readUInt16BE(4);
    const directory = Buffer.from(font.subarray(0, 12 + count * 16));
    offsets.push(position);
    // Table offsets become absolute within the collection.
    for (let index = 0; index < count; index += 1) {
      const at = 12 + index * 16 + 8;
      directory.writeUInt32BE(font.readUInt32BE(at) + position, at);
    }
    parts.push(directory, font.subarray(directory.length));
    position += font.length;
  }
  const header = Buffer.alloc(headerSize);
  header.write('ttcf', 0, 'latin1');
  header.writeUInt32BE(0x00010000, 4);
  header.writeUInt32BE(fonts.length, 8);
  offsets.forEach((offset, index) => header.writeUInt32BE(offset, 12 + index * 4));
  return Buffer.concat([header, ...parts]);
}

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'pdf-editor-fonts-'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('reading font files', () => {
  it('reads family, style and metrics of a plain font', async () => {
    const regular = await readFile(join(DEJAVU, 'DejaVuSerif.ttf'));
    const boldItalic = await readFile(join(DEJAVU, 'DejaVuSerif-BoldItalic.ttf'));
    expect(await readFontFaces(readerOf(regular))).toEqual([{ family: 'DejaVu Serif', bold: false, italic: false, ascent: expect.closeTo(0.93, 1), offset: 0 }]);
    expect(await readFontFaces(readerOf(boldItalic))).toMatchObject([{ family: 'DejaVu Serif', bold: true, italic: true }]);
  });

  it('finds every face of a collection and extracts each as a standalone font', async () => {
    const sans = await readFile(join(DEJAVU, 'DejaVuSans.ttf'));
    const mono = await readFile(join(DEJAVU, 'DejaVuSansMono-Bold.ttf'));
    const collection = makeCollection([sans, mono]);
    const faces = await readFontFaces(readerOf(collection));
    expect(faces.map((face) => [face.family, face.bold])).toEqual([
      ['DejaVu Sans', false],
      ['DejaVu Sans Mono', true],
    ]);

    const extracted = await extractFace(readerOf(collection), faces[1]!.offset, collection.length);
    const parsed = fontkit.create(Buffer.from(extracted!)) as fontkit.Font;
    expect(parsed.familyName).toBe('DejaVu Sans Mono');
    expect(parsed.layout('Жук').glyphs).toHaveLength(3);
    // A plain file is passed through untouched.
    expect(Buffer.from((await extractFace(readerOf(sans), 0, sans.length))!).equals(sans)).toBe(true);
  });

  it('skips fonts that forbid embedding, variable fonts, hidden fonts and broken files', async () => {
    const font = await readFile(join(DEJAVU, 'DejaVuSans.ttf'));
    const count = font.readUInt16BE(4);
    const record = (tag: string): number => {
      for (let index = 0; index < count; index += 1) {
        if (font.toString('latin1', 12 + index * 16, 16 + index * 16) === tag) return 12 + index * 16;
      }
      throw new Error(`no ${tag}`);
    };

    const restricted = Buffer.from(font);
    restricted.writeUInt16BE(0x0002, restricted.readUInt32BE(record('OS/2') + 8) + 8);
    expect(await readFontFaces(readerOf(restricted))).toEqual([]);

    const variable = Buffer.from(font);
    variable.write('fvar', record('gasp'), 4, 'latin1');
    expect(await readFontFaces(readerOf(variable))).toEqual([]);

    expect(await readFontFaces(readerOf(font.subarray(0, 200)))).toEqual([]);
    expect(await readFontFaces(readerOf(Buffer.from('%PDF-1.7 definitely not a font file at all')))).toEqual([]);
    const absurd = Buffer.from(font);
    absurd.writeUInt16BE(60000, 4);
    expect(await readFontFaces(readerOf(absurd))).toEqual([]);
  });
});

describe('SystemFontCatalogue', () => {
  it('groups files into families and serves only what it has listed', async () => {
    for (const name of ['DejaVuSerif.ttf', 'DejaVuSerif-Bold.ttf', 'DejaVuSans-Oblique.ttf']) {
      await writeFile(join(directory, name), await readFile(join(DEJAVU, name)));
    }
    await writeFile(join(directory, 'notes.txt'), 'not a font');
    await writeFile(join(directory, 'broken.ttf'), 'garbage');
    const catalogue = new SystemFontCatalogue([directory, join(directory, 'missing')]);

    expect(await catalogue.list()).toEqual([
      { family: 'DejaVu Sans', regular: false, bold: false, italic: true, boldItalic: false, ascent: expect.any(Number) },
      { family: 'DejaVu Serif', regular: true, bold: true, italic: false, boldItalic: false, ascent: expect.any(Number) },
    ]);
    const bold = await catalogue.read({ family: 'DejaVu Serif', bold: true, italic: false });
    expect(Buffer.from(bold!).equals(await readFile(join(DEJAVU, 'DejaVuSerif-Bold.ttf')))).toBe(true);
    // A style the family lacks, an unknown family, a path instead of a name.
    expect(await catalogue.read({ family: 'DejaVu Serif', bold: false, italic: true })).toBeNull();
    expect(await catalogue.read({ family: 'Nope', bold: false, italic: false })).toBeNull();
    expect(await catalogue.read({ family: join(directory, 'DejaVuSerif.ttf'), bold: false, italic: false })).toBeNull();
  });

  it('knows where each platform keeps its fonts', () => {
    expect(systemFontDirectories('darwin', {}, '/Users/me')).toContain('/System/Library/Fonts/Supplemental');
    expect(systemFontDirectories('win32', { WINDIR: 'D:\\Win', LOCALAPPDATA: 'D:\\Local' }, 'D:\\me')[0]).toMatch(/Win.Fonts$/);
  });

  it.runIf(process.platform === 'darwin')('finds the fonts that come with macOS, Times New Roman included', async () => {
    const catalogue = new SystemFontCatalogue();
    const families = await catalogue.list();
    const times = families.find((family) => family.family === 'Times New Roman');
    expect(times).toMatchObject({ regular: true, bold: true, italic: true, boldItalic: true });
    for (const name of ['Arial', 'Courier New', 'Georgia', 'Verdana']) expect(families.map((family) => family.family)).toContain(name);
    expect(families.every((family) => !family.family.startsWith('.'))).toBe(true);

    const bytes = await catalogue.read({ family: 'Times New Roman', bold: false, italic: true });
    const parsed = fontkit.create(Buffer.from(bytes!)) as fontkit.Font;
    expect(parsed.familyName).toBe('Times New Roman');
    // A face from a system collection comes out as a usable single font.
    const collection = families.find((family) => family.family === 'Helvetica');
    if (collection) {
      const face = await catalogue.read({ family: 'Helvetica', bold: collection.bold && !collection.regular, italic: false });
      expect((fontkit.create(Buffer.from(face!)) as fontkit.Font).familyName).toBe('Helvetica');
    }
  });
});
