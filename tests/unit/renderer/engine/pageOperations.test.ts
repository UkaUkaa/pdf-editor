import { describe, expect, it } from 'vitest';
import type { PageModel } from '@shared/types/document';
import {
  chunkPages,
  createBlankPage,
  deletePages,
  duplicatePages,
  insertPages,
  movePages,
  pageSizeForImage,
  reversePages,
  rotatePages,
  samePages,
  shiftPages,
} from '@renderer/engine/document/pageOperations';

const page = (id: string): PageModel => ({
  id,
  source: { kind: 'pdf', sourceId: 's', pageIndex: id.charCodeAt(0) - 97 },
  box: { x: 0, y: 0, width: 100, height: 200 },
  rotation: 0,
});
const pages = (ids: string): PageModel[] => [...ids].map(page);
const order = (list: PageModel[]): string => list.map((item) => item.id).join('');
const set = (ids: string): Set<string> => new Set(ids);

describe('page operations', () => {
  it('never mutate their input', () => {
    const original = pages('abcd');
    const frozen = Object.freeze([...original]) as PageModel[];
    insertPages(frozen, 1, pages('x'));
    deletePages(frozen, set('b'));
    movePages(frozen, set('a'), 3);
    rotatePages(frozen, set('a'), 90);
    reversePages(frozen);
    expect(order(frozen)).toBe('abcd');
    expect(frozen.every((item, index) => item === original[index])).toBe(true);
  });

  it('inserts at a clamped position', () => {
    expect(order(insertPages(pages('abc'), 0, pages('xy')))).toBe('xyabc');
    expect(order(insertPages(pages('abc'), 2, pages('x')))).toBe('abxc');
    expect(order(insertPages(pages('abc'), 99, pages('x')))).toBe('abcx');
    expect(order(insertPages(pages('abc'), -5, pages('x')))).toBe('xabc');
  });

  it('deletes by id', () => {
    expect(order(deletePages(pages('abcde'), set('bd')))).toBe('ace');
    expect(order(deletePages(pages('abc'), set('z')))).toBe('abc');
  });

  it('duplicates the selection after its last page, with new ids and the same content', () => {
    let counter = 0;
    const result = duplicatePages(pages('abcd'), set('ac'), () => `copy${(counter += 1)}`);
    expect(result.pages.map((item) => item.id)).toEqual(['a', 'b', 'c', 'copy1', 'copy2', 'd']);
    expect(result.copies.map((item) => item.source)).toEqual([page('a').source, page('c').source]);
    expect(duplicatePages(pages('ab'), set(''), () => 'x').copies).toEqual([]);
  });

  it('moves pages to a gap counted in the original list, keeping their order', () => {
    expect(order(movePages(pages('abcde'), set('b'), 4))).toBe('acdbe');
    expect(order(movePages(pages('abcde'), set('d'), 1))).toBe('adbce');
    expect(order(movePages(pages('abcde'), set('ae'), 2))).toBe('baecd');
    expect(order(movePages(pages('abcde'), set('db'), 5))).toBe('acebd');
    expect(order(movePages(pages('abcde'), set('bc'), 0))).toBe('bcade');
    // Dropping a page onto one of its own edges changes nothing.
    expect(order(movePages(pages('abcde'), set('c'), 2))).toBe('abcde');
    expect(order(movePages(pages('abcde'), set('c'), 3))).toBe('abcde');
    expect(order(movePages(pages('abcde'), set('c'), 99))).toBe('abdec');
  });

  it('shifts a selection up or down by one position and stops at the ends', () => {
    expect(order(shiftPages(pages('abcde'), set('c'), -1))).toBe('acbde');
    expect(order(shiftPages(pages('abcde'), set('c'), 1))).toBe('abdce');
    expect(order(shiftPages(pages('abcde'), set('bc'), 1))).toBe('adbce');
    expect(order(shiftPages(pages('abcde'), set('bd'), -1))).toBe('bdace');
    const start = pages('abc');
    expect(samePages(shiftPages(start, set('a'), -1), start)).toBe(true);
    expect(samePages(shiftPages(start, set('c'), 1), start)).toBe(true);
  });

  it('rotates clockwise in quarter turns and wraps around', () => {
    const rotated = rotatePages(pages('ab'), set('a'), 90);
    expect(rotated.map((item) => item.rotation)).toEqual([90, 0]);
    expect(rotatePages(rotated, set('a'), -180)[0]?.rotation).toBe(270);
    expect(rotatePages(rotated, set('a'), 270)[0]?.rotation).toBe(0);
    // Untouched pages keep their identity, which keeps render caches valid.
    expect(rotated[1]).toBe(rotatePages(rotated, set('a'), 90)[1]);
  });

  it('reverses and chunks', () => {
    expect(order(reversePages(pages('abc')))).toBe('cba');
    expect(chunkPages(pages('abcde'), 2).map(order)).toEqual(['ab', 'cd', 'e']);
    expect(chunkPages(pages('abc'), 5).map(order)).toEqual(['abc']);
    expect(chunkPages(pages('abc'), 0).map(order)).toEqual(['a', 'b', 'c']);
  });

  it('creates blank pages and sizes image pages to fit A4 in the image orientation', () => {
    const blank = createBlankPage(() => 'id');
    expect(blank).toMatchObject({ id: 'id', source: { kind: 'blank' }, rotation: 0 });
    expect(blank.box.width).toBeCloseTo(595.28);
    expect(createBlankPage(() => 'x', { width: 300, height: 100 }).box).toMatchObject({ width: 300, height: 100 });

    const landscape = pageSizeForImage(4000, 2000);
    expect(landscape.width).toBeCloseTo(841.89);
    expect(landscape.height).toBeCloseTo(841.89 / 2);
    const portrait = pageSizeForImage(1000, 3000);
    expect(portrait.height).toBeCloseTo(841.89);
    expect(portrait.width / portrait.height).toBeCloseTo(1 / 3);
  });
});
