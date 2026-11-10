import { PDFHexString, PDFName, type PDFDocument, type PDFRef } from '@cantoo/pdf-lib';
import type { Bookmark } from '@shared/types/document';

/** A bookmark as it is written to the file. */
export interface ExportBookmark {
  title: string;
  /** Zero-based index of the target page in the exported document, or `null` for none. */
  pageIndex: number | null;
  children: ExportBookmark[];
}

/**
 * Writes the document outline (bookmarks). Every entry is written expanded and
 * jumps to the top of its page, fitted to the window.
 */
export function writeOutline(document: PDFDocument, bookmarks: readonly ExportBookmark[]): void {
  if (bookmarks.length === 0) return;
  const { context } = document;
  const pages = document.getPages();

  /** Writes one level; returns the refs of its items and the number of entries below `parent`. */
  const writeLevel = (items: readonly ExportBookmark[], parent: PDFRef): { refs: PDFRef[]; count: number } => {
    const refs = items.map(() => context.nextRef());
    let count = items.length;
    items.forEach((item, index) => {
      const ref = refs[index]!;
      const entry: Record<string, unknown> = { Title: PDFHexString.fromText(item.title), Parent: parent };
      if (index > 0) entry['Prev'] = refs[index - 1];
      if (index < items.length - 1) entry['Next'] = refs[index + 1];
      const page = item.pageIndex === null ? undefined : pages[item.pageIndex];
      if (page) entry['Dest'] = [page.ref, PDFName.of('Fit')];
      if (item.children.length > 0) {
        const nested = writeLevel(item.children, ref);
        entry['First'] = nested.refs[0];
        entry['Last'] = nested.refs.at(-1);
        // A positive count means the entry is shown expanded.
        entry['Count'] = nested.count;
        count += nested.count;
      }
      context.assign(ref, context.obj(entry as never));
    });
    return { refs, count };
  };

  const root = context.nextRef();
  const top = writeLevel(bookmarks, root);
  context.assign(root, context.obj({ Type: 'Outlines', First: top.refs[0]!, Last: top.refs.at(-1)!, Count: top.count }));
  document.catalog.set(PDFName.of('Outlines'), root);
}

/** Converts bookmarks to export form, resolving their pages to positions in the exported file. */
export function toExportBookmarks(bookmarks: readonly Bookmark[], pageIndexes: ReadonlyMap<string, number>): ExportBookmark[] {
  return bookmarks.flatMap((bookmark) => {
    const pageIndex = (bookmark.pageId !== null ? pageIndexes.get(bookmark.pageId) : undefined) ?? null;
    const children = toExportBookmarks(bookmark.children, pageIndexes);
    // An entry that leads nowhere and groups nothing (e.g. its page is not exported) is left out.
    return pageIndex === null && children.length === 0 ? [] : [{ title: bookmark.title, pageIndex, children }];
  });
}
