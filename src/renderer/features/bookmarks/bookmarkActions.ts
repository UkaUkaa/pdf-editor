import type { Bookmark } from '@shared/types/document';
import {
  addBookmark,
  findBookmark,
  indentBookmark,
  outdentBookmark,
  removeBookmark,
  renameBookmark,
  shiftBookmark,
} from '../../engine/bookmarks/bookmarkOperations';
import { i18n } from '../../localization/i18n';
import { getActiveDocument, useDocumentsStore } from '../../stores/documentsStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUiStore } from '../../stores/uiStore';
import { goToPage } from '../documents/documentActions';

const store = () => useDocumentsStore.getState();

function commit(change: (tree: Bookmark[]) => Bookmark[]): boolean {
  const document = getActiveDocument();
  if (!document) return false;
  const next = change(document.bookmarks);
  if (next === document.bookmarks) return false;
  store().commit(document.id, { bookmarks: next });
  return true;
}

/**
 * Adds a bookmark for the current page, after the selected bookmark, and opens
 * the bookmarks panel with its title ready to be typed over.
 */
export function addBookmarkForCurrentPage(): void {
  const document = getActiveDocument();
  const page = document?.pages[document.view.currentPage];
  if (!document || !page) return;
  const bookmark: Bookmark = {
    id: crypto.randomUUID(),
    title: i18n.t('viewer.pageLabel', { number: document.view.currentPage + 1 }),
    pageId: page.id,
    children: [],
  };
  const ui = useUiStore.getState();
  commit((tree) => addBookmark(tree, bookmark, ui.selectedBookmarkId));
  useSettingsStore.getState().update({ layout: { leftCollapsed: false, leftTab: 'bookmarks' } });
  ui.setBookmarkFocus(bookmark.id, true);
}

export function renameBookmarkTo(id: string, title: string): void {
  const trimmed = title.trim().slice(0, 200);
  if (trimmed !== '') commit((tree) => renameBookmark(tree, id, trimmed));
}

export function deleteBookmark(id: string): void {
  if (commit((tree) => removeBookmark(tree, id))) useUiStore.getState().setBookmarkFocus(null, false);
}

export const moveBookmark = (id: string, direction: 1 | -1): boolean => commit((tree) => shiftBookmark(tree, id, direction));
export const indentBookmarkById = (id: string): boolean => commit((tree) => indentBookmark(tree, id));
export const outdentBookmarkById = (id: string): boolean => commit((tree) => outdentBookmark(tree, id));

/** Shows the page a bookmark points to. Bookmarks whose page is gone do nothing. */
export function openBookmark(id: string): void {
  const document = getActiveDocument();
  const bookmark = document && findBookmark(document.bookmarks, id);
  if (!document || !bookmark) return;
  useUiStore.getState().setBookmarkFocus(id, false);
  const pageIndex = document.pages.findIndex((page) => page.id === bookmark.pageId);
  if (pageIndex !== -1) goToPage(pageIndex, document.id);
}
