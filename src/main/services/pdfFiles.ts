import { open, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, parse } from 'node:path';
import {
  IMAGE_EXTENSIONS,
  MAX_IMAGE_FILE_SIZE,
  MAX_PDF_FILE_SIZE,
  MAX_PROJECT_FILE_SIZE,
  PROJECT_FILE_EXTENSION,
  type DocumentFileKind,
  type OpenFileError,
  type OpenFileResult,
  type WriteFileResult,
} from '@shared/types/document';
import { writeFileAtomic } from './atomicFile';

/** The `%PDF-` marker must appear within the first kilobyte (ISO 32000 allows leading junk). */
const HEADER_SCAN_BYTES = 1024;
const PDF_MARKER = Buffer.from('%PDF-');

interface ReadOptions {
  /** Allowed extensions, or `null` for any file. */
  extensions: readonly string[] | null;
  maxSize: number;
  wrongType: OpenFileError;
  /** Content sniffing on top of the extension check. */
  accept?: (bytes: Buffer) => boolean;
}

/**
 * Reads a user file for the renderer. Files are untrusted input, and this is
 * the only way the renderer can read from disk, so the checks are strict:
 * absolute path, expected extension, regular file, size limit, content check.
 */
async function readUserFile(path: string, options: ReadOptions): Promise<OpenFileResult> {
  const name = basename(path);
  const fail = (error: OpenFileError): OpenFileResult => ({ ok: false, path, name, error });

  if (!isAbsolute(path) || path.includes('\0')) return fail('notFound');
  if (options.extensions && !options.extensions.includes(extname(path).slice(1).toLowerCase())) return fail(options.wrongType);

  let handle;
  try {
    handle = await open(path, 'r');
  } catch (error) {
    return fail((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'notFound' : 'unreadable');
  }

  try {
    const stats = await handle.stat();
    if (!stats.isFile()) return fail(options.wrongType);
    if (stats.size > options.maxSize) return fail('tooLarge');

    const data = Buffer.allocUnsafe(stats.size);
    let offset = 0;
    while (offset < stats.size) {
      const { bytesRead } = await handle.read(data, offset, stats.size - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const bytes = data.subarray(0, offset);
    if (options.accept && !options.accept(bytes)) return fail(options.wrongType);

    // A plain Uint8Array view with its own buffer survives structured cloning over IPC.
    return { ok: true, file: { path, name, size: bytes.length, data: new Uint8Array(bytes) } };
  } catch {
    return fail('unreadable');
  } finally {
    await handle.close();
  }
}

const hasPdfHeader = (bytes: Uint8Array): boolean =>
  Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, HEADER_SCAN_BYTES)).indexOf(PDF_MARKER) !== -1;

export function readPdfFile(path: string, maxSize = MAX_PDF_FILE_SIZE): Promise<OpenFileResult> {
  return readUserFile(path, { extensions: ['pdf'], maxSize, wrongType: 'notPdf', accept: hasPdfHeader });
}

export function readImageFile(path: string, maxSize = MAX_IMAGE_FILE_SIZE): Promise<OpenFileResult> {
  return readUserFile(path, { extensions: IMAGE_EXTENSIONS, maxSize, wrongType: 'notImage' });
}

const ZIP_MARKER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
/** Project files are ZIP archives; their content is validated by the renderer when it is parsed. */
export const hasZipHeader = (bytes: Uint8Array): boolean =>
  bytes.byteLength >= 4 && Buffer.from(bytes.buffer, bytes.byteOffset, 4).equals(ZIP_MARKER);

export function readProjectFile(path: string, maxSize = MAX_PROJECT_FILE_SIZE): Promise<OpenFileResult> {
  return readUserFile(path, { extensions: [PROJECT_FILE_EXTENSION.slice(1)], maxSize, wrongType: 'notPdf', accept: hasZipHeader });
}

/** Reads a document of either kind, chosen by the file extension. */
export function readDocumentFile(path: string): Promise<OpenFileResult> {
  return isProjectPath(path) ? readProjectFile(path) : readPdfFile(path);
}

/** Files attached to a document may be of any type; they are stored, never opened or executed. */
export const MAX_ATTACHMENT_SIZE = 128 * 1024 * 1024;

export function readAttachmentFile(path: string, maxSize = MAX_ATTACHMENT_SIZE): Promise<OpenFileResult> {
  return readUserFile(path, { extensions: null, maxSize, wrongType: 'unreadable' });
}

/** Reduces a file name from a PDF to a safe base name, keeping its extension. */
export function sanitiseFileName(suggested: string): string {
  const base = basename(suggested.replaceAll('\\', '/'));
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim().slice(0, 160);
  return cleaned || 'attachment';
}

export const isPdfPath = (path: string): boolean =>
  isAbsolute(path) && !path.includes('\0') && extname(path).toLowerCase() === '.pdf';

export const isProjectPath = (path: string): boolean =>
  isAbsolute(path) && !path.includes('\0') && extname(path).toLowerCase() === PROJECT_FILE_EXTENSION;

export const isDocumentPath = (path: string): boolean => isPdfPath(path) || isProjectPath(path);

/**
 * Writes a generated PDF. The data goes to a temporary file first and replaces
 * the target only after it is completely on disk, so an existing document is
 * never left half-written.
 */
export async function writePdfFile(path: string, data: Uint8Array): Promise<WriteFileResult> {
  if (!isPdfPath(path) || data.byteLength === 0 || !hasPdfHeader(data)) return { ok: false, error: 'invalid' };
  try {
    await writeFileAtomic(path, data);
    const { size } = await stat(path);
    if (size !== data.byteLength) return { ok: false, error: 'writeFailed' };
    return { ok: true, path, size };
  } catch {
    return { ok: false, error: 'writeFailed' };
  }
}

/** Writes a project archive, atomically like a PDF. */
export async function writeProjectFile(path: string, data: Uint8Array): Promise<WriteFileResult> {
  if (!isProjectPath(path) || !hasZipHeader(data)) return { ok: false, error: 'invalid' };
  try {
    await writeFileAtomic(path, data);
    const { size } = await stat(path);
    if (size !== data.byteLength) return { ok: false, error: 'writeFailed' };
    return { ok: true, path, size };
  } catch {
    return { ok: false, error: 'writeFailed' };
  }
}

/** Writes a document of either kind; the data must match the extension of the path. */
export function writeDocumentFile(path: string, data: Uint8Array): Promise<WriteFileResult> {
  return isProjectPath(path) ? writeProjectFile(path, data) : writePdfFile(path, data);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

/**
 * Writes an exported page image into `directory` under a name that does not
 * exist yet. Only real PNG and JPEG data is accepted, under the matching extension.
 */
export async function writeImageFile(directory: string, fileName: string, data: Uint8Array): Promise<WriteFileResult> {
  const { name, ext } = parse(sanitiseFileName(fileName));
  const extension = ext.toLowerCase();
  const head = Buffer.from(data.buffer, data.byteOffset, Math.min(data.byteLength, 8));
  const valid =
    (extension === '.png' && head.subarray(0, 8).equals(PNG_SIGNATURE)) ||
    ((extension === '.jpg' || extension === '.jpeg') && head.subarray(0, 3).equals(JPEG_SIGNATURE));
  if (!isAbsolute(directory) || !valid) return { ok: false, error: 'invalid' };
  try {
    let target = join(directory, `${name}${extension}`);
    for (let attempt = 2; attempt < 10_000; attempt += 1) {
      const exists = await stat(target).then(
        () => true,
        () => false,
      );
      if (!exists) break;
      target = join(directory, `${name} (${attempt})${extension}`);
    }
    await writeFileAtomic(target, data);
    return { ok: true, path: target, size: data.byteLength };
  } catch {
    return { ok: false, error: 'writeFailed' };
  }
}

/** Reduces a suggested file name to a safe `<name>.pdf` without any directory parts. */
export function sanitisePdfFileName(suggested: string, kind: DocumentFileKind = 'pdf'): string {
  const stem = parse(basename(suggested.replaceAll('\\', '/'))).name;
  // Characters that are invalid on Windows or meaningful to shells; control characters too.
  // eslint-disable-next-line no-control-regex
  const cleaned = stem.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim().slice(0, 120);
  return `${cleaned || 'document'}${kind === 'project' ? PROJECT_FILE_EXTENSION : '.pdf'}`;
}

/** Picks a name in `directory` that does not exist yet: `name.pdf`, `name (2).pdf`, … */
export async function uniquePdfPath(directory: string, fileName: string): Promise<string> {
  const { name } = parse(sanitisePdfFileName(fileName));
  for (let attempt = 1; attempt < 10_000; attempt += 1) {
    const candidate = join(directory, attempt === 1 ? `${name}.pdf` : `${name} (${attempt}).pdf`);
    const exists = await stat(candidate).then(
      () => true,
      () => false,
    );
    if (!exists) return candidate;
  }
  throw new Error('Cannot find a free file name');
}
