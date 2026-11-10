import { open, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { extname, join } from 'node:path';
import { MAX_FONT_FAMILY_LENGTH, type FontFaceRequest, type SystemFontFamily } from '@shared/types/fonts';

/**
 * Fonts installed on the computer. Commercial fonts such as Times New Roman or
 * Arial may not be shipped with the application, but the copies that come with
 * the operating system can be used: they are read from the system font
 * folders, shown in the font list and embedded into saved PDFs — provided the
 * font itself permits embedding (its `fsType` licence flags).
 *
 * Font files are untrusted input like any other file: only the tables that are
 * needed are read, with bounds checks, and the renderer gets bytes of fonts
 * from this catalogue only — never an arbitrary path.
 */

const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.ttc', '.otc']);
/** Larger files are pan-Unicode or CJK collections; embedding them is impractical. */
const MAX_FONT_FILE_SIZE = 40 * 1024 * 1024;
const MAX_TABLES = 512;
const MAX_FACES_PER_FILE = 64;
const MAX_NAME_TABLE = 512 * 1024;

export function systemFontDirectories(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string[] {
  if (platform === 'darwin') {
    return ['/System/Library/Fonts', '/System/Library/Fonts/Supplemental', '/Library/Fonts', join(home, 'Library', 'Fonts')];
  }
  if (platform === 'win32') {
    const directories = [join(env['WINDIR'] ?? env['SystemRoot'] ?? 'C:\\Windows', 'Fonts')];
    if (env['LOCALAPPDATA']) directories.push(join(env['LOCALAPPDATA'], 'Microsoft', 'Windows', 'Fonts'));
    return directories;
  }
  return ['/usr/share/fonts', '/usr/local/share/fonts', join(home, '.fonts'), join(home, '.local', 'share', 'fonts')];
}

export interface FontFaceInfo {
  family: string;
  bold: boolean;
  italic: boolean;
  /** Ascender height as a fraction of the font size. */
  ascent: number;
  /** Offset of the face's table directory inside the file (non-zero only in collections). */
  offset: number;
}

interface TableRecord {
  tag: string;
  checksum: number;
  offset: number;
  length: number;
}

type Reader = (position: number, length: number) => Promise<Buffer | null>;

const SFNT_VERSIONS = new Set([0x00010000, 0x4f54544f, 0x74727565]); // TrueType, 'OTTO', 'true'

async function readTableDirectory(read: Reader, offset: number): Promise<TableRecord[] | null> {
  const header = await read(offset, 12);
  if (!header || !SFNT_VERSIONS.has(header.readUInt32BE(0))) return null;
  const count = header.readUInt16BE(4);
  if (count === 0 || count > MAX_TABLES) return null;
  const records = await read(offset + 12, count * 16);
  if (!records) return null;
  const tables: TableRecord[] = [];
  for (let index = 0; index < count; index += 1) {
    const at = index * 16;
    tables.push({
      tag: records.toString('latin1', at, at + 4),
      checksum: records.readUInt32BE(at + 4),
      offset: records.readUInt32BE(at + 8),
      length: records.readUInt32BE(at + 12),
    });
  }
  return tables;
}

/** Reads the family name: the Windows English entry when there is one, otherwise a Macintosh Roman one. */
function familyName(table: Buffer): string | null {
  if (table.length < 6) return null;
  const count = table.readUInt16BE(2);
  const storage = table.readUInt16BE(4);
  let fallback: string | null = null;
  for (let index = 0; index < count; index += 1) {
    const at = 6 + index * 12;
    if (at + 12 > table.length) break;
    if (table.readUInt16BE(at + 6) !== 1) continue; // nameID 1: font family
    const platform = table.readUInt16BE(at);
    const language = table.readUInt16BE(at + 4);
    const start = storage + table.readUInt16BE(at + 10);
    const end = start + table.readUInt16BE(at + 8);
    if (end > table.length) continue;
    if (platform === 3 || platform === 0) {
      // UTF-16BE
      const name = Buffer.from(table.subarray(start, end - ((end - start) % 2))).swap16().toString('utf16le');
      if (platform === 3 && language === 0x409) return name;
      fallback ??= name;
    } else if (platform === 1 && language === 0) {
      fallback ??= table.toString('latin1', start, end);
    }
  }
  return fallback;
}

/** Characters that have no place in a family name; such fonts are skipped rather than "repaired". */
// eslint-disable-next-line no-control-regex
const UNSAFE_NAME = /[\u0000-\u001f\u007f"\\<>]/;

async function readFace(read: Reader, offset: number): Promise<FontFaceInfo | null> {
  const tables = await readTableDirectory(read, offset);
  if (!tables) return null;
  const table = (tag: string, minimum: number, maximum = 4096): Promise<Buffer | null> => {
    const record = tables.find((candidate) => candidate.tag === tag);
    if (!record || record.length < minimum) return Promise.resolve(null);
    return read(record.offset, Math.min(record.length, maximum));
  };
  // Variable fonts need instancing before they can be embedded; that is not supported.
  if (tables.some((record) => record.tag === 'fvar')) return null;

  const [name, head, hhea, os2] = await Promise.all([table('name', 6, MAX_NAME_TABLE), table('head', 54), table('hhea', 8), table('OS/2', 10)]);
  if (!name || !head || !hhea) return null;
  const family = familyName(name)?.trim();
  // Names starting with a dot are private system fonts that applications are not meant to list.
  if (!family || family.startsWith('.') || family.length > MAX_FONT_FAMILY_LENGTH || UNSAFE_NAME.test(family)) return null;

  if (os2) {
    const fsType = os2.readUInt16BE(8);
    // 0x0002: embedding not permitted. 0x0200: only bitmaps may be embedded.
    if ((fsType & 0x0002) !== 0 || (fsType & 0x0200) !== 0) return null;
  }
  const unitsPerEm = head.readUInt16BE(18);
  if (unitsPerEm < 16 || unitsPerEm > 16384) return null;
  const macStyle = head.readUInt16BE(44);
  const fsSelection = os2 && os2.length >= 64 ? os2.readUInt16BE(62) : null;
  const ascent = hhea.readInt16BE(4) / unitsPerEm;
  return {
    family,
    bold: fsSelection !== null ? (fsSelection & 0x20) !== 0 : (macStyle & 1) !== 0,
    italic: fsSelection !== null ? (fsSelection & 0x01) !== 0 : (macStyle & 2) !== 0,
    ascent: Number.isFinite(ascent) ? Math.min(Math.max(ascent, 0.5), 1.3) : 0.9,
    offset,
  };
}

/** Describes every usable face in a font file (one for .ttf/.otf, several for collections). */
export async function readFontFaces(read: Reader): Promise<FontFaceInfo[]> {
  const header = await read(0, 12);
  if (!header) return [];
  let offsets = [0];
  if (header.toString('latin1', 0, 4) === 'ttcf') {
    const count = Math.min(header.readUInt32BE(8), MAX_FACES_PER_FILE);
    const list = await read(12, count * 4);
    if (!list) return [];
    offsets = Array.from({ length: count }, (_, index) => list.readUInt32BE(index * 4));
  }
  const faces: FontFaceInfo[] = [];
  for (const offset of offsets) {
    const face = await readFace(read, offset).catch(() => null);
    if (face) faces.push(face);
  }
  return faces;
}

/**
 * Builds a standalone font file for one face. A plain .ttf/.otf is returned
 * as it is; a face of a collection is copied out table by table, because PDF
 * embedding and the browser both need a single-face file.
 */
export async function extractFace(read: Reader, offset: number, fileSize: number): Promise<Uint8Array | null> {
  if (offset === 0) {
    const whole = await read(0, fileSize);
    const signature = whole?.toString('latin1', 0, 4);
    if (whole && signature !== 'ttcf') return new Uint8Array(whole);
  }
  const tables = await readTableDirectory(read, offset);
  const header = await read(offset, 12);
  if (!tables || !header) return null;

  const directorySize = 12 + tables.length * 16;
  const padded = (length: number): number => (length + 3) & ~3;
  const total = directorySize + tables.reduce((sum, record) => sum + padded(record.length), 0);
  if (total > MAX_FONT_FILE_SIZE) return null;
  const output = Buffer.alloc(total);
  header.copy(output, 0, 0, 12);
  let position = directorySize;
  for (const [index, record] of tables.entries()) {
    const data = await read(record.offset, record.length);
    if (!data) return null;
    data.copy(output, position);
    const at = 12 + index * 16;
    output.write(record.tag, at, 4, 'latin1');
    output.writeUInt32BE(record.checksum, at + 4);
    output.writeUInt32BE(position, at + 8);
    output.writeUInt32BE(record.length, at + 12);
    position += padded(record.length);
  }
  return new Uint8Array(output);
}

interface CatalogueFace extends FontFaceInfo {
  path: string;
  size: number;
}

const variantKey = (bold: boolean, italic: boolean): 'regular' | 'bold' | 'italic' | 'boldItalic' =>
  bold ? (italic ? 'boldItalic' : 'bold') : italic ? 'italic' : 'regular';

async function withFile<T>(path: string, size: number, work: (read: Reader) => Promise<T>): Promise<T> {
  const handle = await open(path, 'r');
  try {
    const read: Reader = async (position, length) => {
      if (position < 0 || length < 0 || position + length > size) return null;
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      return bytesRead === length ? buffer : null;
    };
    return await work(read);
  } finally {
    await handle.close();
  }
}

async function listFontFiles(directory: string, depth = 0): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && depth < 3) files.push(...(await listFontFiles(path, depth + 1)));
    else if (entry.isFile() && FONT_EXTENSIONS.has(extname(entry.name).toLowerCase())) files.push(path);
  }
  return files;
}

/** The fonts found on this computer. Scanned once, on first use. */
export class SystemFontCatalogue {
  private scan: Promise<Map<string, Map<string, CatalogueFace>>> | null = null;

  constructor(
    private readonly directories: readonly string[] = systemFontDirectories(),
    private readonly onWarning: (message: string) => void = () => undefined,
  ) {}

  private faces(): Promise<Map<string, Map<string, CatalogueFace>>> {
    this.scan ??= (async () => {
      const families = new Map<string, Map<string, CatalogueFace>>();
      for (const directory of this.directories) {
        for (const path of await listFontFiles(directory)) {
          try {
            const { size } = await stat(path);
            if (size < 12 || size > MAX_FONT_FILE_SIZE) continue;
            for (const face of await withFile(path, size, readFontFaces)) {
              const family = families.get(face.family) ?? new Map<string, CatalogueFace>();
              families.set(face.family, family);
              // The first file found wins: system folders come before the user's own.
              const key = variantKey(face.bold, face.italic);
              if (!family.has(key)) family.set(key, { ...face, path, size });
            }
          } catch (error) {
            this.onWarning(`Cannot read font ${path}: ${String(error)}`);
          }
        }
      }
      return families;
    })();
    return this.scan;
  }

  async list(): Promise<SystemFontFamily[]> {
    const families = await this.faces();
    return [...families.entries()]
      .map(([family, faces]) => ({
        family,
        regular: faces.has('regular'),
        bold: faces.has('bold'),
        italic: faces.has('italic'),
        boldItalic: faces.has('boldItalic'),
        ascent: (faces.get('regular') ?? [...faces.values()][0]!).ascent,
      }))
      .sort((a, b) => a.family.localeCompare(b.family));
  }

  /** Bytes of exactly the requested style, or `null` when the family does not have it. */
  async read({ family, bold, italic }: FontFaceRequest): Promise<Uint8Array | null> {
    const face = (await this.faces()).get(family)?.get(variantKey(bold, italic));
    if (!face) return null;
    try {
      return await withFile(face.path, face.size, (read) => extractFace(read, face.offset, face.size));
    } catch (error) {
      this.onWarning(`Cannot read font ${face.path}: ${String(error)}`);
      return null;
    }
  }
}
