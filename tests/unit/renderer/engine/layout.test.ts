import { describe, expect, it } from 'vitest';
import { BitmapCache } from '@renderer/engine/rendering/bitmapCache';
import {
  captureAnchor,
  computeLayout,
  findCurrentPage,
  findVisiblePages,
  PAGE_GAP,
  restoreAnchor,
  scrollTopForPage,
  VIEWER_PADDING,
} from '@renderer/engine/rendering/layout';
import {
  clampZoom,
  formatZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  referencePageSize,
  resolveZoom,
  stepZoom,
} from '@renderer/engine/rendering/zoom';

const portrait = { width: 600, height: 800 };
const landscape = { width: 800, height: 600 };
const pages = (count: number) => Array.from({ length: count }, () => portrait);
const base = { scale: 1, currentPage: 0, viewportWidth: 1000 };

describe('computeLayout', () => {
  it('stacks pages vertically and centres them in continuous mode', () => {
    const layout = computeLayout([portrait, landscape, portrait], { ...base, viewMode: 'continuous' });
    expect(layout.rows).toHaveLength(3);
    expect(layout.rects[0]).toMatchObject({ x: 200, y: VIEWER_PADDING, width: 600, height: 800 });
    expect(layout.rects[1]).toMatchObject({ x: 100, y: VIEWER_PADDING + 800 + PAGE_GAP });
    expect(layout.width).toBe(1000);
    expect(layout.height).toBe(VIEWER_PADDING * 2 + 800 + 600 + 800 + PAGE_GAP * 2);
  });

  it('grows wider than the viewport when pages do not fit', () => {
    const layout = computeLayout([landscape], { ...base, viewMode: 'continuous', scale: 2 });
    expect(layout.width).toBe(1600 + VIEWER_PADDING * 2);
    expect(layout.rects[0]?.x).toBe(VIEWER_PADDING);
  });

  it('pairs pages in two-page mode and keeps an odd last page alone', () => {
    const layout = computeLayout([portrait, landscape, portrait], { ...base, viewMode: 'twoPage', viewportWidth: 2000 });
    expect(layout.rows.map((row) => row.pages.map((page) => page.pageIndex))).toEqual([[0, 1], [2]]);
    const [left, right] = layout.rows[0]!.pages;
    expect(right!.x).toBe(left!.x + 600 + PAGE_GAP);
    // The shorter page is centred vertically within the row.
    expect(right!.y).toBe(left!.y + 100);
  });

  it('lays out only the current page in single-page mode', () => {
    const layout = computeLayout(pages(5), { ...base, viewMode: 'single', currentPage: 3 });
    expect(layout.rows).toHaveLength(1);
    expect(layout.rects[3]).toBeDefined();
    expect(layout.rects[0]).toBeUndefined();
    expect(computeLayout(pages(5), { ...base, viewMode: 'single', currentPage: 99 }).rects[4]).toBeDefined();
  });

  it('handles an empty document', () => {
    const layout = computeLayout([], { ...base, viewMode: 'continuous' });
    expect(layout).toMatchObject({ rows: [], height: 0, width: 1000 });
    expect(findCurrentPage(layout, 0, 500)).toBeNull();
  });
});

describe('virtualisation', () => {
  const layout = computeLayout(pages(500), { ...base, viewMode: 'continuous' });
  const rowHeight = 800 + PAGE_GAP;

  it('returns only the pages near the viewport, even for 500 pages', () => {
    const scrollTop = VIEWER_PADDING + rowHeight * 250;
    const visible = findVisiblePages(layout, scrollTop, 900, 0).map((rect) => rect.pageIndex);
    expect(visible).toEqual([250, 251]);
    const withOverscan = findVisiblePages(layout, scrollTop, 900, 900).map((rect) => rect.pageIndex);
    expect(withOverscan[0]).toBe(248);
    expect(withOverscan.at(-1)).toBe(252);
    expect(findVisiblePages(layout, 0, 900, 0).map((rect) => rect.pageIndex)).toEqual([0, 1]);
  });

  it('picks the most visible page as current and the earlier one on ties', () => {
    expect(findCurrentPage(layout, 0, 900)).toBe(0);
    expect(findCurrentPage(layout, VIEWER_PADDING + rowHeight * 3, 900)).toBe(3);
    // Scrolled so that page 3 shows 300px and page 4 shows 588px.
    expect(findCurrentPage(layout, VIEWER_PADDING + rowHeight * 3 + 500, 900)).toBe(4);
    // Small pages: the page at the top wins although several are fully visible.
    const small = computeLayout(Array.from({ length: 10 }, () => ({ width: 100, height: 100 })), {
      ...base,
      viewMode: 'continuous',
    });
    expect(findCurrentPage(small, scrollTopForPage(small, 4)!, 900)).toBe(4);
  });

  it('computes scroll targets and restores anchors across zoom changes', () => {
    expect(scrollTopForPage(layout, 0)).toBe(0);
    expect(scrollTopForPage(layout, 2)).toBe(rowHeight * 2);
    expect(scrollTopForPage(layout, 9999)).toBeNull();

    const scrollTop = layout.rects[7]!.y + 200; // a quarter into page 7
    const anchor = captureAnchor(layout, scrollTop)!;
    expect(anchor).toEqual({ pageIndex: 7, ratio: 0.25 });
    const zoomed = computeLayout(pages(500), { ...base, viewMode: 'continuous', scale: 2 });
    expect(restoreAnchor(zoomed, anchor)).toBe(zoomed.rects[7]!.y + 400);
    expect(restoreAnchor(layout, captureAnchor(layout, 12345)!)).toBeCloseTo(12345, 6);
  });
});

describe('zoom', () => {
  const a4 = { width: 595.28, height: 841.89 };

  it('steps through the zoom ladder and clamps at both ends', () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(0.61, 1)).toBe(0.67);
    expect(stepZoom(0.61, -1)).toBe(0.5);
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
    expect(clampZoom(100)).toBe(MAX_ZOOM);
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(formatZoom(1.254)).toBe('125%');
  });

  it('fits the page width and the whole page into the viewport', () => {
    const viewport = { width: 1000, height: 700 };
    const fitWidth = resolveZoom({ zoomMode: 'fitWidth', customScale: 1, viewMode: 'continuous', page: a4, viewport });
    expect(a4.width * fitWidth * (96 / 72)).toBeCloseTo(1000 - VIEWER_PADDING * 2, 6);
    const fitPage = resolveZoom({ zoomMode: 'fitPage', customScale: 1, viewMode: 'single', page: a4, viewport });
    expect(a4.height * fitPage * (96 / 72)).toBeCloseTo(700 - VIEWER_PADDING * 2, 6);
    const twoPage = resolveZoom({ zoomMode: 'fitWidth', customScale: 1, viewMode: 'twoPage', page: a4, viewport });
    expect(2 * a4.width * twoPage * (96 / 72) + PAGE_GAP).toBeCloseTo(1000 - VIEWER_PADDING * 2, 6);
  });

  it('uses the custom zoom as is and survives an unmeasured viewport', () => {
    const viewport = { width: 0, height: 0 };
    expect(resolveZoom({ zoomMode: 'custom', customScale: 2.5, viewMode: 'continuous', page: a4, viewport })).toBe(2.5);
    expect(resolveZoom({ zoomMode: 'fitWidth', customScale: 2.5, viewMode: 'continuous', page: a4, viewport })).toBe(1);
    expect(referencePageSize([portrait, landscape])).toEqual({ width: 800, height: 800 });
  });
});

describe('BitmapCache', () => {
  const bitmap = (side: number) => ({ width: side, height: side });

  it('evicts least recently used entries when over the pixel budget', () => {
    const cache = new BitmapCache(250);
    cache.set('a', bitmap(10));
    cache.set('b', bitmap(10));
    expect(cache.get('a')).toBeDefined(); // "a" is now the most recently used
    cache.set('c', bitmap(10));
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBeDefined();
    expect(cache.get('c')).toBeDefined();
    expect(cache.totalPixels).toBe(200);
  });

  it('always keeps the newest entry, replaces duplicates and deletes by prefix', () => {
    const cache = new BitmapCache(50);
    cache.set('doc1:p1', bitmap(10));
    expect(cache.size).toBe(1);
    cache.set('doc1:p1', bitmap(5));
    expect(cache.totalPixels).toBe(25);
    cache.set('doc2:p1', bitmap(5));
    cache.deleteByPrefix('doc1:');
    expect(cache.get('doc1:p1')).toBeUndefined();
    expect(cache.get('doc2:p1')).toBeDefined();
    expect(cache.totalPixels).toBe(25);
  });
});
