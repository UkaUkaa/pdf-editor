import { describe, expect, it } from 'vitest';
import type { Bookmark } from '@shared/types/document';
import type { EditorObject } from '@shared/types/objects';
import {
  addBookmark,
  bookmarksFromOutline,
  findBookmark,
  flattenBookmarks,
  indentBookmark,
  outdentBookmark,
  removeBookmark,
  renameBookmark,
  shiftBookmark,
} from '@renderer/engine/bookmarks/bookmarkOperations';
import { createMatcher, findMatches, searchObjects, searchRuns } from '@renderer/engine/search/search';

const options = { caseSensitive: false, wholeWord: false };
const run = (text: string, patch = {}) => ({ text, x: 100, baseline: 200, angle: 0, width: text.length * 10, fontSize: 10, fontFamily: 'sans' as const, ...patch });

describe('search', () => {
  it('matches literally, ignoring case unless asked, in Latin and Cyrillic', () => {
    expect(createMatcher('  ', options)).toBeNull();
    expect(findMatches('a.b a+b a.b', createMatcher('a.b', options)!)).toEqual([[0, 3], [8, 11]]);
    expect(findMatches('Привет, ПРИВЕТ, привет', createMatcher('привет', options)!)).toHaveLength(3);
    expect(findMatches('Привет, ПРИВЕТ, привет', createMatcher('привет', { ...options, caseSensitive: true })!)).toEqual([[16, 22]]);
    expect(findMatches('Їжак і їжак', createMatcher('їжак', options)!)).toHaveLength(2);
    expect(findMatches('(test) [x]', createMatcher('(test)', options)!)).toEqual([[0, 6]]);
  });

  it('respects word boundaries for any alphabet', () => {
    const whole = { caseSensitive: false, wholeWord: true };
    expect(findMatches('cat concat cat_x cat.', createMatcher('cat', whole)!)).toEqual([[0, 3], [17, 20]]);
    expect(findMatches('кот котёнок скот «кот»', createMatcher('кот', whole)!)).toEqual([[0, 3], [18, 21]]);
    expect(findMatches('page 12 and 123', createMatcher('12', whole)!)).toEqual([[5, 7]]);
  });

  it('locates matches inside a line and builds snippets', () => {
    const hits = searchRuns('p1', [run('The quick brown fox jumps over the lazy dog and keeps running far away')], createMatcher('fox', options)!);
    expect(hits).toHaveLength(1);
    // Characters 16–19 of a 10pt-per-character line starting at x = 100.
    expect(hits[0]).toMatchObject({ pageId: 'p1', x: 260, width: 30, y: 191, height: 12, match: 'fox', source: 'page' });
    expect(hits[0]!.before).toBe('The quick brown ');
    expect(hits[0]!.after.endsWith('…')).toBe(true);
    expect(searchRuns('p1', [run('aaa')], createMatcher('a', options)!)).toHaveLength(3);

    // Text running straight down the page (90° clockwise): the same match, turned.
    const [turned] = searchRuns('p1', [run('abcdef', { angle: 90 })], createMatcher('cd', options)!);
    expect(turned!.y).toBeCloseTo(220);
    expect(turned!.height).toBeCloseTo(20);
    expect(turned!.x).toBeCloseTo(100 - 3);
    expect(turned!.width).toBeCloseTo(12);
    // Slanted text gets the box around the slanted stretch.
    const [slanted] = searchRuns('p1', [run('abcd', { angle: 45 })], createMatcher('abcd', options)!);
    expect(slanted!.width).toBeCloseTo(slanted!.height);
    expect(slanted!.width).toBeGreaterThan(30);
  });

  it('finds text in text objects and highlights the whole object', () => {
    const text = { id: 't', layerId: 'l', type: 'text', text: 'Draft\nversion two', x: 5, y: 6, width: 70, height: 30 } as EditorObject;
    const shape = { id: 's', layerId: 'l', type: 'shape' } as EditorObject;
    const hits = searchObjects('p2', [text, shape], createMatcher('version', options)!);
    expect(hits).toEqual([expect.objectContaining({ pageId: 'p2', x: 5, y: 6, width: 70, height: 30, match: 'version', source: 'object', before: 'Draft ' })]);
  });
});

describe('bookmarks', () => {
  const mark = (id: string, children: Bookmark[] = []): Bookmark => ({ id, title: id.toUpperCase(), pageId: `page-${id}`, children });
  const tree = [mark('a', [mark('a1'), mark('a2')]), mark('b'), mark('c')];
  const shape = (list: readonly Bookmark[]): string =>
    list.map((item) => (item.children.length > 0 ? `${item.id}(${shape(item.children)})` : item.id)).join(' ');

  it('flattens with depth and finds nested entries', () => {
    expect(flattenBookmarks(tree).map((row) => `${row.depth}${row.bookmark.id}`)).toEqual(['0a', '1a1', '1a2', '0b', '0c']);
    expect(findBookmark(tree, 'a2')?.title).toBe('A2');
    expect(findBookmark(tree, 'zz')).toBeUndefined();
  });

  it('adds after a sibling at any depth, or at the end', () => {
    expect(shape(addBookmark(tree, mark('x'), 'a1'))).toBe('a(a1 x a2) b c');
    expect(shape(addBookmark(tree, mark('x'), 'b'))).toBe('a(a1 a2) b x c');
    expect(shape(addBookmark(tree, mark('x'), null))).toBe('a(a1 a2) b c x');
    expect(shape(addBookmark(tree, mark('x'), 'missing'))).toBe('a(a1 a2) b c x');
  });

  it('removes, renames and reorders without touching other branches', () => {
    expect(shape(removeBookmark(tree, 'a'))).toBe('b c');
    expect(shape(removeBookmark(tree, 'a1'))).toBe('a(a2) b c');
    const renamed = renameBookmark(tree, 'a2', 'New');
    expect(findBookmark(renamed, 'a2')?.title).toBe('New');
    expect(renamed[1]).toBe(tree[1]);
    expect(renameBookmark(tree, 'a2', 'A2')).toBe(tree);
    expect(shape(shiftBookmark(tree, 'c', -1))).toBe('a(a1 a2) c b');
    expect(shape(shiftBookmark(tree, 'a1', 1))).toBe('a(a2 a1) b c');
    expect(shiftBookmark(tree, 'a', -1)).toBe(tree);
    expect(shiftBookmark(tree, 'c', 1)).toBe(tree);
  });

  it('nests under the entry above and moves out again', () => {
    const nested = indentBookmark(tree, 'c');
    expect(shape(nested)).toBe('a(a1 a2) b(c)');
    expect(indentBookmark(tree, 'a')).toBe(tree);
    expect(shape(indentBookmark(tree, 'a2'))).toBe('a(a1(a2)) b c');
    expect(shape(outdentBookmark(nested, 'c'))).toBe('a(a1 a2) b c');
    expect(shape(outdentBookmark(tree, 'a1'))).toBe('a(a2) a1 b c');
    expect(outdentBookmark(tree, 'b')).toBe(tree);
  });

  it('converts a PDF outline, dropping targets that do not exist', () => {
    let next = 0;
    const result = bookmarksFromOutline(
      [{ title: 'One', pageIndex: 0, children: [{ title: 'Deep', pageIndex: 7, children: [] }] }, { title: 'No target', pageIndex: null, children: [] }],
      (index) => (index < 2 ? `page${index}` : null),
      () => `id${(next += 1)}`,
    );
    expect(result).toEqual([
      { id: 'id1', title: 'One', pageId: 'page0', children: [{ id: 'id2', title: 'Deep', pageId: null, children: [] }] },
      { id: 'id3', title: 'No target', pageId: null, children: [] },
    ]);
  });
});
