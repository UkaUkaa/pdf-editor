import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DocumentModel } from '@shared/types/document';
import { CSS_PIXELS_PER_POINT, displaySize, pageGeometry } from '../../engine/coordinates/pageCoordinates';
import {
  captureAnchor,
  computeLayout,
  findCurrentPage,
  findVisiblePages,
  restoreAnchor,
  scrollTopForPage,
  type ScrollAnchor,
  type ViewerLayout,
} from '../../engine/rendering/layout';
import { clampZoom, referencePageSize, resolveZoom } from '../../engine/rendering/zoom';
import { useScrollMetrics } from '../../hooks/useScrollMetrics';
import { useDocumentsStore } from '../../stores/documentsStore';
import { useToolStore } from '../../stores/toolStore';
import { useUiStore } from '../../stores/uiStore';
import {
  activateTool,
  deleteSelectedObjects,
  insertImageFiles,
  nudgeSelectedObjects,
  selectObjects,
} from '../pdf-editor/objectActions';
import { PageOverlay } from '../pdf-editor/PageOverlay';
import { goToPage, goToRelativePage, setCustomZoom } from '../documents/documentActions';
import { PageView } from './PageView';

interface PdfViewerProps {
  document: DocumentModel;
}

/**
 * Scrollable, virtualised view of one document. Only pages near the viewport
 * are mounted and rendered; everything else is represented by empty space.
 */
export function PdfViewer({ document: doc }: PdfViewerProps): React.JSX.Element {
  const { t } = useTranslation();
  const updateView = useDocumentsStore((state) => state.updateView);
  const scrollRef = useRef<HTMLDivElement>(null);
  const metrics = useScrollMetrics(scrollRef);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const tool = useToolStore((state) => state.tool);
  const { viewMode, zoomMode, customScale, currentPage, navigationSeq } = doc.view;

  const sizes = useMemo(() => doc.pages.map((page) => displaySize(pageGeometry(page))), [doc.pages]);
  const reference = useMemo(() => referencePageSize(sizes), [sizes]);
  const measured = metrics.width > 0 && metrics.height > 0;
  const zoom = resolveZoom({ zoomMode, customScale, viewMode, page: reference, viewport: metrics });
  const scale = zoom * CSS_PIXELS_PER_POINT;

  // Only single-page mode lays out a specific page; elsewhere the layout must not
  // change (and trigger scroll restoration) just because the current page did.
  const layoutPage = viewMode === 'single' ? currentPage : 0;
  const layout = useMemo(
    () => computeLayout(sizes, { viewMode, scale, currentPage: layoutPage, viewportWidth: metrics.width }),
    [sizes, viewMode, scale, layoutPage, metrics.width],
  );

  // Publish the zoom actually in effect (fit modes depend on the window size).
  useEffect(() => {
    if (measured) updateView(doc.id, { effectiveZoom: zoom });
  }, [doc.id, measured, updateView, zoom]);

  // --- Scroll position management ------------------------------------------------------
  const previousLayout = useRef<ViewerLayout | null>(null);
  const anchor = useRef<ScrollAnchor | null>(null);
  const handledNavigation = useRef<number | null>(null);
  /** After explicit navigation the chosen page stays current until the user scrolls. */
  const pinnedScrollTop = useRef<number | null>(null);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || !measured) return;

    if (handledNavigation.current !== navigationSeq) {
      // Explicit navigation (also the first layout of a newly shown document).
      handledNavigation.current = navigationSeq;
      element.scrollTop = scrollTopForPage(layout, currentPage) ?? 0;
      pinnedScrollTop.current = element.scrollTop;
    } else if (previousLayout.current !== layout && viewMode !== 'single' && anchor.current) {
      // Zoom, resize or view-mode change: keep the same content at the top of the viewport.
      const top = restoreAnchor(layout, anchor.current);
      if (top !== null) {
        const wasPinned = pinnedScrollTop.current === element.scrollTop;
        element.scrollTop = top;
        if (wasPinned) pinnedScrollTop.current = element.scrollTop;
      }
    }
    previousLayout.current = layout;
    anchor.current = captureAnchor(layout, element.scrollTop);
  }, [layout, measured, navigationSeq, currentPage, viewMode]);

  // Track the current page while the user scrolls.
  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;
  const hasSelectionRef = useRef(false);
  hasSelectionRef.current = doc.selectedObjects.length > 0;
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !measured) return;
    anchor.current = captureAnchor(layout, element.scrollTop);
    if (viewMode === 'single' || pinnedScrollTop.current === element.scrollTop) return;
    pinnedScrollTop.current = null;
    // While objects are selected, their page stays current for as long as it is on screen.
    const currentRect = layout.rects[currentPageRef.current];
    const stillVisible =
      currentRect !== undefined &&
      currentRect.y < element.scrollTop + element.clientHeight &&
      currentRect.y + currentRect.height > element.scrollTop;
    if (hasSelectionRef.current && stillVisible) return;
    const page = findCurrentPage(layout, element.scrollTop, element.clientHeight);
    if (page !== null) updateView(doc.id, { currentPage: page });
  }, [doc.id, layout, measured, metrics.scrollTop, metrics.height, updateView, viewMode]);

  // --- Ctrl/Cmd + wheel zoom ------------------------------------------------------------
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setCustomZoom(clampZoom(zoomRef.current * Math.exp(-event.deltaY * 0.002)), doc.id);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [doc.id]);

  // --- Panning with the hand tool or Space + drag ----------------------------------------
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const panning = tool === 'hand' || spaceHeld;

  // Images pasted from the system clipboard become objects on the current page.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      if (useUiStore.getState().textFieldFocused) return;
      const files = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith('image/'));
      if (files.length === 0) return;
      event.preventDefault();
      void insertImageFiles(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === ' ' && !event.repeat) {
      event.preventDefault();
      setSpaceHeld(true);
      return;
    }
    if (doc.selectedObjects.length > 0) {
      // Keys act on the selected objects before they act on the view.
      const step = event.shiftKey ? 10 : 1;
      const nudges: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const nudge = nudges[event.key];
      if (nudge) {
        event.preventDefault();
        nudgeSelectedObjects(...nudge);
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelectedObjects();
        return;
      }
    }
    if (event.key === 'Escape') {
      if (doc.selectedObjects.length > 0) selectObjects(doc.id, []);
      else if (tool !== 'select') activateTool('select');
      return;
    }
    const isSingle = viewMode === 'single';
    if (event.key === 'PageDown' || (isSingle && event.key === 'ArrowRight')) {
      if (!isSingle && event.key === 'PageDown') return; // native scrolling handles it
      event.preventDefault();
      goToRelativePage(1);
    } else if (event.key === 'PageUp' || (isSingle && event.key === 'ArrowLeft')) {
      if (!isSingle && event.key === 'PageUp') return;
      event.preventDefault();
      goToRelativePage(-1);
    } else if (event.key === 'Home' && (isSingle || event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      goToPage(0, doc.id);
    } else if (event.key === 'End' && (isSingle || event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      goToPage(doc.pages.length - 1, doc.id);
    }
  };

  const devicePixelRatio = window.devicePixelRatio || 1;
  const visible = measured ? findVisiblePages(layout, metrics.scrollTop, metrics.height, metrics.height) : [];

  return (
    <div
      ref={scrollRef}
      className="viewer"
      role="region"
      aria-label={t('viewer.label')}
      tabIndex={0}
      data-panning={panning || undefined}
      data-tool={tool}
      data-zoom={zoom.toFixed(4)}
      onKeyDown={onKeyDown}
      onKeyUp={(event) => {
        if (event.key === ' ') setSpaceHeld(false);
      }}
      onBlur={() => setSpaceHeld(false)}
      onPointerDown={(event) => {
        if (!panning || event.button !== 0) return;
        const element = event.currentTarget;
        element.setPointerCapture?.(event.pointerId);
        pan.current = { x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop };
      }}
      onPointerMove={(event) => {
        if (!pan.current) return;
        event.currentTarget.scrollLeft = pan.current.left - (event.clientX - pan.current.x);
        event.currentTarget.scrollTop = pan.current.top - (event.clientY - pan.current.y);
      }}
      onPointerUp={() => {
        pan.current = null;
      }}
      onPointerCancel={() => {
        pan.current = null;
      }}
    >
      <div className="viewer__content" style={{ width: layout.width, height: layout.height }}>
        {visible.map((rect) => {
          const page = doc.pages[rect.pageIndex];
          if (!page) return null;
          return (
            <div
              key={page.id}
              className="viewer__page"
              role="img"
              aria-label={t('viewer.pageLabel', { number: rect.pageIndex + 1 })}
              data-page-number={rect.pageIndex + 1}
              style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
            >
              <PageView documentId={doc.id} page={page} pixelsPerPoint={scale * devicePixelRatio} />
              <PageOverlay document={doc} page={page} scale={scale} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
