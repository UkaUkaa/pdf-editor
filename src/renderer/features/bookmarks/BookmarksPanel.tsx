import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, IndentDecrease, IndentIncrease, Trash2 } from 'lucide-react';
import type { Bookmark, DocumentModel } from '@shared/types/document';
import { flattenBookmarks } from '../../engine/bookmarks/bookmarkOperations';
import { useUiStore } from '../../stores/uiStore';
import {
  deleteBookmark,
  indentBookmarkById,
  moveBookmark,
  openBookmark,
  outdentBookmarkById,
  renameBookmarkTo,
} from './bookmarkActions';

function TitleEditor({ bookmark, onDone }: { bookmark: Bookmark; onDone: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  const [title, setTitle] = useState(bookmark.title);
  const cancelled = useRef(false);
  return (
    <input
      className="input bookmark__input"
      aria-label={t('bookmarks.rename')}
      autoFocus
      maxLength={200}
      value={title}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setTitle(event.target.value)}
      onBlur={() => {
        if (!cancelled.current) renameBookmarkTo(bookmark.id, title);
        onDone();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          cancelled.current = true;
          event.currentTarget.blur();
        }
      }}
    />
  );
}

interface BookmarksPanelProps {
  document: DocumentModel;
}

/** Outline of the document: click to jump, double-click to rename, buttons to restructure. */
export function BookmarksPanel({ document }: BookmarksPanelProps): React.JSX.Element {
  const { t } = useTranslation();
  const selectedId = useUiStore((state) => state.selectedBookmarkId);
  const renaming = useUiStore((state) => state.renamingBookmark);
  const setFocus = useUiStore((state) => state.setBookmarkFocus);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const pageNumbers = new Map(document.pages.map((page, index) => [page.id, index + 1]));
  // Entries below a collapsed bookmark are not listed.
  const rows: Array<{ bookmark: Bookmark; depth: number }> = [];
  const hiddenBelow: number[] = [];
  for (const row of flattenBookmarks(document.bookmarks)) {
    while (hiddenBelow.length > 0 && row.depth <= hiddenBelow.at(-1)!) hiddenBelow.pop();
    if (hiddenBelow.length > 0) continue;
    rows.push(row);
    if (collapsed.has(row.bookmark.id)) hiddenBelow.push(row.depth);
  }
  const hasSelection = selectedId !== null && rows.some((row) => row.bookmark.id === selectedId);

  const tool = (label: string, Icon: typeof Trash2, run: (id: string) => void): React.JSX.Element => (
    <button
      type="button"
      className="icon-button icon-button--small"
      aria-label={label}
      title={label}
      aria-disabled={!hasSelection}
      onClick={() => {
        if (hasSelection && selectedId) run(selectedId);
      }}
    >
      <Icon size={15} aria-hidden />
    </button>
  );

  return (
    <div className="bookmarks">
      <div className="bookmarks__tools">
        {tool(t('bookmarks.moveUp'), ArrowUp, (id) => moveBookmark(id, -1))}
        {tool(t('bookmarks.moveDown'), ArrowDown, (id) => moveBookmark(id, 1))}
        {tool(t('bookmarks.indent'), IndentIncrease, (id) => indentBookmarkById(id))}
        {tool(t('bookmarks.outdent'), IndentDecrease, (id) => outdentBookmarkById(id))}
        {tool(t('bookmarks.delete'), Trash2, deleteBookmark)}
      </div>
      {rows.length === 0 ? (
        <p className="panel__empty">{t('bookmarks.empty')}</p>
      ) : (
        <ul className="bookmarks__list" role="tree" aria-label={t('sidebar.tabs.bookmarks')}>
          {rows.map(({ bookmark, depth }) => {
            const isCollapsed = collapsed.has(bookmark.id);
            const Chevron = isCollapsed ? ChevronRight : ChevronDown;
            const page = bookmark.pageId ? pageNumbers.get(bookmark.pageId) : undefined;
            return (
              <li
                key={bookmark.id}
                className="bookmark"
                role="treeitem"
                aria-level={depth + 1}
                aria-selected={bookmark.id === selectedId}
                aria-expanded={bookmark.children.length > 0 ? !isCollapsed : undefined}
                data-bookmark-id={bookmark.id}
                style={{ paddingLeft: 4 + depth * 16 }}
              >
                {bookmark.children.length > 0 ? (
                  <button
                    type="button"
                    className="icon-button icon-button--small"
                    aria-label={t('bookmarks.toggle')}
                    onClick={() =>
                      setCollapsed((current) => {
                        const next = new Set(current);
                        if (!next.delete(bookmark.id)) next.add(bookmark.id);
                        return next;
                      })
                    }
                  >
                    <Chevron size={14} aria-hidden />
                  </button>
                ) : (
                  <span className="bookmark__spacer" />
                )}
                {renaming && bookmark.id === selectedId ? (
                  <TitleEditor bookmark={bookmark} onDone={() => setFocus(bookmark.id, false)} />
                ) : (
                  <button
                    type="button"
                    className="bookmark__title"
                    title={bookmark.title}
                    onClick={() => openBookmark(bookmark.id)}
                    onDoubleClick={() => setFocus(bookmark.id, true)}
                  >
                    {bookmark.title}
                  </button>
                )}
                <span className="bookmark__page">{page ?? t('common.none')}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
