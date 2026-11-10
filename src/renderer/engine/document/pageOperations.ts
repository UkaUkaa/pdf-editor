import { A4_SIZE, type PageModel, type PageRotation } from '@shared/types/document';
import { normaliseRotation, type Size } from '../coordinates/pageCoordinates';

/**
 * Pure operations on the page list. They never mutate their input and always
 * return a new array, which is what makes snapshot-based undo/redo reliable.
 */

export type IdFactory = () => string;

export function createBlankPage(makeId: IdFactory, size: Size = A4_SIZE): PageModel {
  return {
    id: makeId(),
    source: { kind: 'blank' },
    box: { x: 0, y: 0, width: size.width, height: size.height },
    rotation: 0,
  };
}

const clampIndex = (index: number, length: number): number => Math.min(Math.max(Math.trunc(index), 0), length);

/** Inserts pages so that the first new page ends up at `index`. */
export function insertPages(pages: readonly PageModel[], index: number, added: readonly PageModel[]): PageModel[] {
  const at = clampIndex(index, pages.length);
  return [...pages.slice(0, at), ...added, ...pages.slice(at)];
}

export function deletePages(pages: readonly PageModel[], ids: ReadonlySet<string>): PageModel[] {
  return pages.filter((page) => !ids.has(page.id));
}

/** Copies the given pages (in document order) and inserts the copies after the last of them. */
export function duplicatePages(
  pages: readonly PageModel[],
  ids: ReadonlySet<string>,
  makeId: IdFactory,
): { pages: PageModel[]; copies: PageModel[] } {
  const copies = pages.filter((page) => ids.has(page.id)).map((page) => ({ ...page, id: makeId() }));
  if (copies.length === 0) return { pages: [...pages], copies };
  const last = pages.findLastIndex((page) => ids.has(page.id));
  return { pages: insertPages(pages, last + 1, copies), copies };
}

/**
 * Moves the given pages, keeping their relative order, so that they are
 * inserted at gap `targetIndex` of the *original* list (0 = before the first
 * page, `pages.length` = after the last one).
 */
export function movePages(pages: readonly PageModel[], ids: ReadonlySet<string>, targetIndex: number): PageModel[] {
  const moving = pages.filter((page) => ids.has(page.id));
  if (moving.length === 0) return [...pages];
  const target = clampIndex(targetIndex, pages.length);
  // Gaps are counted in the original list; removing earlier pages shifts the target left.
  const before = pages.slice(0, target).filter((page) => !ids.has(page.id));
  const after = pages.slice(target).filter((page) => !ids.has(page.id));
  return [...before, ...moving, ...after];
}

/** Moves the selected pages one position towards the start (-1) or the end (+1) as a block. */
export function shiftPages(pages: readonly PageModel[], ids: ReadonlySet<string>, direction: 1 | -1): PageModel[] {
  const indexes = pages.flatMap((page, index) => (ids.has(page.id) ? [index] : []));
  const first = indexes[0];
  const last = indexes.at(-1);
  if (first === undefined || last === undefined) return [...pages];
  return movePages(pages, ids, direction === -1 ? first - 1 : last + 2);
}

/** Rotates pages clockwise by `delta` degrees (a multiple of 90, may be negative). */
export function rotatePages(pages: readonly PageModel[], ids: ReadonlySet<string>, delta: number): PageModel[] {
  return pages.map((page) =>
    ids.has(page.id) ? { ...page, rotation: normaliseRotation(page.rotation + delta) as PageRotation } : page,
  );
}

export function reversePages(pages: readonly PageModel[]): PageModel[] {
  return [...pages].reverse();
}

/** Splits the page list into consecutive chunks of `size` pages (the last one may be shorter). */
export function chunkPages(pages: readonly PageModel[], size: number): PageModel[][] {
  const step = Math.max(1, Math.trunc(size));
  const chunks: PageModel[][] = [];
  for (let index = 0; index < pages.length; index += step) chunks.push(pages.slice(index, index + step));
  return chunks;
}

/** True when both lists contain the same pages in the same order with the same properties. */
export function samePages(a: readonly PageModel[], b: readonly PageModel[]): boolean {
  return a.length === b.length && a.every((page, index) => page === b[index]);
}

/**
 * Page size for an imported image: the image fills the whole page, and the
 * page is as large as fits into A4 in the image's own orientation.
 */
export function pageSizeForImage(pixelWidth: number, pixelHeight: number): Size {
  const landscape = pixelWidth > pixelHeight;
  const maxWidth = landscape ? A4_SIZE.height : A4_SIZE.width;
  const maxHeight = landscape ? A4_SIZE.width : A4_SIZE.height;
  const scale = Math.min(maxWidth / pixelWidth, maxHeight / pixelHeight);
  return { width: pixelWidth * scale, height: pixelHeight * scale };
}
