import type { Bookmark } from '@shared/types/document';

/** Pure operations on the bookmark tree. Untouched branches keep their identity. */

export interface OutlineNode {
  title: string;
  /** Zero-based page index in the source file, or `null` when the entry has no page target. */
  pageIndex: number | null;
  children: OutlineNode[];
}

export interface FlatBookmark {
  bookmark: Bookmark;
  depth: number;
}

export function flattenBookmarks(tree: readonly Bookmark[], depth = 0): FlatBookmark[] {
  return tree.flatMap((bookmark) => [{ bookmark, depth }, ...flattenBookmarks(bookmark.children, depth + 1)]);
}

export function findBookmark(tree: readonly Bookmark[], id: string): Bookmark | undefined {
  for (const bookmark of tree) {
    if (bookmark.id === id) return bookmark;
    const nested = findBookmark(bookmark.children, id);
    if (nested) return nested;
  }
  return undefined;
}

/** Applies `change` to the sibling list that contains `id`; returns the tree unchanged when it is not found. */
function inSiblings(
  tree: readonly Bookmark[],
  id: string,
  change: (siblings: readonly Bookmark[], index: number) => Bookmark[] | null,
): Bookmark[] {
  const index = tree.findIndex((bookmark) => bookmark.id === id);
  if (index !== -1) return change(tree, index) ?? (tree as Bookmark[]);
  let changed = false;
  const next = tree.map((bookmark) => {
    const children = inSiblings(bookmark.children, id, change);
    if (children === bookmark.children) return bookmark;
    changed = true;
    return { ...bookmark, children };
  });
  return changed ? next : (tree as Bookmark[]);
}

/** Inserts a bookmark right after `afterId` (as its sibling), or at the end of the top level. */
export function addBookmark(tree: readonly Bookmark[], bookmark: Bookmark, afterId?: string | null): Bookmark[] {
  if (afterId && findBookmark(tree, afterId)) {
    return inSiblings(tree, afterId, (siblings, index) => [
      ...siblings.slice(0, index + 1),
      bookmark,
      ...siblings.slice(index + 1),
    ]);
  }
  return [...tree, bookmark];
}

/** Removes a bookmark together with everything nested in it. */
export function removeBookmark(tree: readonly Bookmark[], id: string): Bookmark[] {
  return inSiblings(tree, id, (siblings, index) => siblings.filter((_, position) => position !== index));
}

export function renameBookmark(tree: readonly Bookmark[], id: string, title: string): Bookmark[] {
  return inSiblings(tree, id, (siblings, index) =>
    siblings[index]!.title === title ? null : siblings.map((bookmark, position) => (position === index ? { ...bookmark, title } : bookmark)),
  );
}

/** Moves a bookmark one place up (-1) or down (+1) among its siblings. */
export function shiftBookmark(tree: readonly Bookmark[], id: string, direction: 1 | -1): Bookmark[] {
  return inSiblings(tree, id, (siblings, index) => {
    const target = index + direction;
    if (target < 0 || target >= siblings.length) return null;
    const next = [...siblings];
    [next[index], next[target]] = [next[target]!, next[index]!];
    return next;
  });
}

/** Nests a bookmark under the sibling above it. */
export function indentBookmark(tree: readonly Bookmark[], id: string): Bookmark[] {
  return inSiblings(tree, id, (siblings, index) => {
    const above = siblings[index - 1];
    if (!above) return null;
    const moved = siblings[index]!;
    return [
      ...siblings.slice(0, index - 1),
      { ...above, children: [...above.children, moved] },
      ...siblings.slice(index + 1),
    ];
  });
}

/** Moves a nested bookmark one level out, placing it right after its former parent. */
export function outdentBookmark(tree: readonly Bookmark[], id: string): Bookmark[] {
  const parentIndex = tree.findIndex((bookmark) => bookmark.children.some((child) => child.id === id));
  if (parentIndex !== -1) {
    const parent = tree[parentIndex]!;
    const moved = parent.children.find((child) => child.id === id)!;
    return [
      ...tree.slice(0, parentIndex),
      { ...parent, children: parent.children.filter((child) => child.id !== id) },
      moved,
      ...tree.slice(parentIndex + 1),
    ];
  }
  let changed = false;
  const next = tree.map((bookmark) => {
    const children = outdentBookmark(bookmark.children, id);
    if (children === bookmark.children) return bookmark;
    changed = true;
    return { ...bookmark, children };
  });
  return changed ? next : (tree as Bookmark[]);
}

/** Converts the outline of a source PDF into bookmarks that point at pages of the document. */
export function bookmarksFromOutline(
  outline: readonly OutlineNode[],
  pageIdAt: (sourcePageIndex: number) => string | null,
  makeId: () => string,
): Bookmark[] {
  return outline.map((node) => ({
    id: makeId(),
    title: node.title,
    pageId: node.pageIndex === null ? null : pageIdAt(node.pageIndex),
    children: bookmarksFromOutline(node.children, pageIdAt, makeId),
  }));
}
