import type { ViewMode } from '@shared/types/document';
import type { Size } from '../coordinates/pageCoordinates';

/** Space between pages and around the document, in CSS pixels. */
export const PAGE_GAP = 12;
export const VIEWER_PADDING = 16;

export interface PageRect {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutRow {
  y: number;
  height: number;
  pages: PageRect[];
}

export interface ViewerLayout {
  rows: LayoutRow[];
  /** Rect of every laid-out page, indexed by page index (sparse in single-page mode). */
  rects: Array<PageRect | undefined>;
  width: number;
  height: number;
}

export interface LayoutOptions {
  viewMode: ViewMode;
  /** CSS pixels per PDF point at the current zoom. */
  scale: number;
  /** Only used by single-page mode, which lays out just this page. */
  currentPage: number;
  viewportWidth: number;
}

/**
 * Positions pages inside the scrollable area. Pure function of its inputs, so
 * virtualisation never needs to measure the DOM.
 */
export function computeLayout(sizes: readonly Size[], options: LayoutOptions): ViewerLayout {
  const { viewMode, scale, viewportWidth } = options;
  const groups: number[][] = [];
  if (sizes.length > 0) {
    if (viewMode === 'single') {
      groups.push([Math.min(Math.max(options.currentPage, 0), sizes.length - 1)]);
    } else if (viewMode === 'twoPage') {
      for (let index = 0; index < sizes.length; index += 2) {
        groups.push(index + 1 < sizes.length ? [index, index + 1] : [index]);
      }
    } else {
      for (let index = 0; index < sizes.length; index += 1) groups.push([index]);
    }
  }

  const measured = groups.map((group) => {
    const pages = group.map((pageIndex) => {
      const size = sizes[pageIndex]!;
      return { pageIndex, width: size.width * scale, height: size.height * scale };
    });
    const width = pages.reduce((sum, page) => sum + page.width, 0) + PAGE_GAP * (pages.length - 1);
    const height = Math.max(...pages.map((page) => page.height));
    return { pages, width, height };
  });

  const contentWidth = Math.max(0, ...measured.map((row) => row.width)) + VIEWER_PADDING * 2;
  const width = Math.max(contentWidth, viewportWidth);

  const rows: LayoutRow[] = [];
  const rects: Array<PageRect | undefined> = [];
  let y = VIEWER_PADDING;
  for (const row of measured) {
    let x = (width - row.width) / 2;
    const pages = row.pages.map((page) => {
      // Pages of different heights in one row are centred vertically.
      const rect: PageRect = { ...page, x, y: y + (row.height - page.height) / 2 };
      x += page.width + PAGE_GAP;
      rects[page.pageIndex] = rect;
      return rect;
    });
    rows.push({ y, height: row.height, pages });
    y += row.height + PAGE_GAP;
  }
  const height = rows.length > 0 ? y - PAGE_GAP + VIEWER_PADDING : 0;
  return { rows, rects, width, height };
}

/** Pages intersecting the viewport, extended by `overscan` pixels above and below. */
export function findVisiblePages(
  layout: ViewerLayout,
  scrollTop: number,
  viewportHeight: number,
  overscan: number,
): PageRect[] {
  const top = scrollTop - overscan;
  const bottom = scrollTop + viewportHeight + overscan;
  const { rows } = layout;

  // Binary search for the first row whose bottom edge is below `top`.
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    const row = rows[middle]!;
    if (row.y + row.height < top) low = middle + 1;
    else high = middle;
  }

  const visible: PageRect[] = [];
  for (let index = low; index < rows.length; index += 1) {
    const row = rows[index]!;
    if (row.y > bottom) break;
    visible.push(...row.pages);
  }
  return visible;
}

/** The page considered "current": the one with the largest visible part (the earlier page wins ties). */
export function findCurrentPage(layout: ViewerLayout, scrollTop: number, viewportHeight: number): number | null {
  const { rows } = layout;
  if (rows.length === 0) return null;
  const bottom = scrollTop + viewportHeight;
  let best: LayoutRow | undefined;
  let bestVisible = 0;
  for (const row of rows) {
    if (row.y > bottom) break;
    const visible = Math.min(row.y + row.height, bottom) - Math.max(row.y, scrollTop);
    if (visible > bestVisible) {
      best = row;
      bestVisible = visible;
    }
  }
  // Nothing intersects (e.g. scrolled into padding): fall back to the nearest row above.
  best ??= rows.findLast((row) => row.y <= scrollTop) ?? rows[0];
  return best?.pages[0]?.pageIndex ?? null;
}

export function scrollTopForPage(layout: ViewerLayout, pageIndex: number): number | null {
  const rect = layout.rects[pageIndex];
  return rect ? Math.max(0, rect.y - VIEWER_PADDING) : null;
}

export interface ScrollAnchor {
  pageIndex: number;
  /** Vertical position inside the page, as a fraction of its height (may be negative). */
  ratio: number;
}

/** Remembers what is at the top of the viewport so it can be restored after a re-layout. */
export function captureAnchor(layout: ViewerLayout, scrollTop: number): ScrollAnchor | null {
  let candidate: PageRect | undefined;
  for (const row of layout.rows) {
    const rect = row.pages[0];
    if (!rect) continue;
    if (row.y + row.height >= scrollTop) {
      candidate = rect;
      break;
    }
    candidate = rect;
  }
  if (!candidate || candidate.height === 0) return null;
  return { pageIndex: candidate.pageIndex, ratio: (scrollTop - candidate.y) / candidate.height };
}

export function restoreAnchor(layout: ViewerLayout, anchor: ScrollAnchor): number | null {
  const rect = layout.rects[anchor.pageIndex];
  return rect ? Math.max(0, rect.y + anchor.ratio * rect.height) : null;
}
