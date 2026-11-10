import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DocumentModel } from '@shared/types/document';
import { ContextMenu, type ContextMenuItem } from '../../components/ContextMenu';
import { displaySize, pageGeometry } from '../../engine/coordinates/pageCoordinates';
import { useScrollMetrics } from '../../hooks/useScrollMetrics';
import { executeCommand } from '../../services/commands';
import { goToPage } from '../documents/documentActions';
import { PageObjectsPreview } from '../pdf-editor/PageOverlay';
import { PageView } from '../pdf-viewer/PageView';
import { clearSelection, movePagesTo, selectAllPages, selectPage } from './pageActions';

const MAX_THUMBNAIL_WIDTH = 132;
const MAX_THUMBNAIL_HEIGHT = 190;
const LABEL_HEIGHT = 20;
const ITEM_GAP = 12;
const PANEL_PADDING = 12;
/** Marks drags that carry pages of this application (as opposed to files from the OS). */
const DRAG_TYPE = 'application/x-pdf-editor-pages';

const NO_OBJECTS: never[] = [];

const CONTEXT_MENU: readonly ContextMenuItem[] = [
  'pages.rotateCw',
  'pages.rotateCcw',
  'separator',
  'pages.moveUp',
  'pages.moveDown',
  'separator',
  'pages.addBlank',
  'pages.duplicate',
  'pages.extract',
  'separator',
  'pages.delete',
];

interface ThumbnailItem {
  top: number;
  width: number;
  height: number;
  /** CSS pixels per PDF point of the thumbnail image. */
  scale: number;
}

function layoutThumbnails(document: DocumentModel): { items: ThumbnailItem[]; height: number } {
  let top = PANEL_PADDING;
  const items = document.pages.map((page) => {
    const size = displaySize(pageGeometry(page));
    const scale = Math.min(MAX_THUMBNAIL_WIDTH / size.width, MAX_THUMBNAIL_HEIGHT / size.height);
    const item = { top, width: size.width * scale, height: size.height * scale, scale };
    top += item.height + LABEL_HEIGHT + ITEM_GAP;
    return item;
  });
  return { items, height: top - ITEM_GAP + PANEL_PADDING };
}

/** Gap (0 … pages.length) nearest to a vertical position inside the list. */
function gapAt(items: readonly ThumbnailItem[], y: number): number {
  const index = items.findIndex((item) => y < item.top + (item.height + LABEL_HEIGHT) / 2);
  return index === -1 ? items.length : index;
}

function gapPosition(items: readonly ThumbnailItem[], gap: number): number {
  const item = items[gap];
  if (item) return item.top - ITEM_GAP / 2;
  const last = items.at(-1);
  return last ? last.top + last.height + LABEL_HEIGHT + ITEM_GAP / 2 : PANEL_PADDING;
}

interface ThumbnailsPanelProps {
  document: DocumentModel;
}

/**
 * Virtualised list of page thumbnails. Pages can be selected (click,
 * Ctrl/Cmd-click, Shift-click), reordered by dragging and acted on through the
 * context menu; every change goes through undoable page commands.
 */
export function ThumbnailsPanel({ document: doc }: ThumbnailsPanelProps): React.JSX.Element {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const metrics = useScrollMetrics(scrollRef);
  const { items, height } = useMemo(() => layoutThumbnails(doc), [doc]);
  const [dropGap, setDropGap] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const currentPage = doc.view.currentPage;
  const selection = useMemo(() => new Set(doc.selection), [doc.selection]);

  // Keep the current page's thumbnail in view while the main view scrolls.
  useEffect(() => {
    const element = scrollRef.current;
    const item = items[currentPage];
    if (!element || !item || element.clientHeight === 0) return;
    const bottom = item.top + item.height + LABEL_HEIGHT;
    if (item.top < element.scrollTop) {
      element.scrollTop = Math.max(0, item.top - PANEL_PADDING);
    } else if (bottom > element.scrollTop + element.clientHeight) {
      element.scrollTop = bottom + PANEL_PADDING - element.clientHeight;
    }
  }, [currentPage, items]);

  const isPageDrag = (event: React.DragEvent): boolean => event.dataTransfer.types.includes(DRAG_TYPE);
  const gapFromEvent = (event: React.DragEvent): number => {
    const element = scrollRef.current;
    if (!element) return 0;
    return gapAt(items, event.clientY - element.getBoundingClientRect().top + element.scrollTop);
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      event.stopPropagation();
      selectAllPages(doc.id);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      executeCommand('pages.delete');
    } else if (event.key === 'Escape') {
      clearSelection(doc.id);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = Math.min(Math.max(currentPage + (event.key === 'ArrowDown' ? 1 : -1), 0), doc.pages.length - 1);
      const page = doc.pages[next];
      if (!page) return;
      selectPage(doc.id, page.id, event.shiftKey ? 'range' : 'single');
      if (!event.shiftKey) goToPage(next, doc.id);
    }
  };

  const overscan = 300;
  const top = metrics.scrollTop - overscan;
  const bottom = metrics.scrollTop + metrics.height + overscan;
  const devicePixelRatio = window.devicePixelRatio || 1;

  return (
    <div
      ref={scrollRef}
      className="thumbnails"
      role="listbox"
      aria-multiselectable
      aria-label={t('thumbnails.label')}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onDragOver={(event) => {
        if (!isPageDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setDropGap(gapFromEvent(event));
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropGap(null);
      }}
      onDrop={(event) => {
        if (!isPageDrag(event)) return;
        event.preventDefault();
        setDropGap(null);
        movePagesTo(doc.id, doc.selection, gapFromEvent(event));
      }}
    >
      <div className="thumbnails__content" style={{ height }}>
        {items.map((item, index) => {
          if (metrics.height === 0 || item.top + item.height + LABEL_HEIGHT < top || item.top > bottom) return null;
          const page = doc.pages[index];
          if (!page) return null;
          const label = t('viewer.pageLabel', { number: index + 1 });
          return (
            <button
              key={page.id}
              type="button"
              role="option"
              className="thumbnail"
              aria-selected={selection.has(page.id)}
              aria-current={index === currentPage ? 'page' : undefined}
              aria-label={label}
              data-page-number={index + 1}
              style={{ top: item.top }}
              draggable
              onClick={(event) => {
                const mode = event.shiftKey ? 'range' : event.ctrlKey || event.metaKey ? 'toggle' : 'single';
                selectPage(doc.id, page.id, mode);
                // Shift-click extends the selection from the current page, which therefore stays put;
                // Ctrl/Cmd-click on a selected page only removes it from the selection.
                const deselecting = mode === 'toggle' && selection.has(page.id);
                if (mode !== 'range' && !deselecting) goToPage(index, doc.id);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                if (!selection.has(page.id)) {
                  selectPage(doc.id, page.id, 'single');
                  goToPage(index, doc.id);
                }
                setMenu({ x: event.clientX, y: event.clientY });
              }}
              onDragStart={(event) => {
                // Dragging an unselected page moves just that page.
                if (!selection.has(page.id)) selectPage(doc.id, page.id, 'single');
                event.dataTransfer.setData(DRAG_TYPE, doc.id);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => setDropGap(null)}
            >
              <span className="thumbnail__image" style={{ width: item.width, height: item.height }}>
                <PageView documentId={doc.id} page={page} pixelsPerPoint={item.scale * devicePixelRatio} />
                <PageObjectsPreview page={page} objects={doc.objects[page.id] ?? NO_OBJECTS} layers={doc.layers[page.id] ?? NO_OBJECTS} />
              </span>
              <span className="thumbnail__label">{index + 1}</span>
            </button>
          );
        })}
        {dropGap !== null && (
          <div
            className="thumbnails__drop-indicator"
            role="presentation"
            title={t('thumbnails.dropHere')}
            style={{ top: gapPosition(items, dropGap) }}
          />
        )}
      </div>
      {menu && <ContextMenu label={t('menu.pages')} x={menu.x} y={menu.y} items={CONTEXT_MENU} onClose={closeMenu} />}
    </div>
  );
}
