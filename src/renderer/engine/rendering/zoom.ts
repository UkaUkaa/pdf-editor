import type { ViewMode, ZoomMode } from '@shared/types/document';
import { CSS_PIXELS_PER_POINT, type Size } from '../coordinates/pageCoordinates';
import { PAGE_GAP, VIEWER_PADDING } from './layout';

/** Zoom factors: 1 means 100 %, i.e. the page at its physical size. */
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 6.4;
export const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6.4] as const;
/** Zoom levels offered in the toolbar. */
export const ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Next step above or below the given zoom, tolerant of floating-point noise. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  const epsilon = 0.001;
  if (direction === 1) {
    return ZOOM_STEPS.find((step) => step > zoom + epsilon) ?? MAX_ZOOM;
  }
  return [...ZOOM_STEPS].reverse().find((step) => step < zoom - epsilon) ?? MIN_ZOOM;
}

/** Largest width and height among all pages; fitting to it keeps the zoom stable while scrolling. */
export function referencePageSize(sizes: readonly Size[]): Size {
  return sizes.reduce<Size>(
    (acc, size) => ({ width: Math.max(acc.width, size.width), height: Math.max(acc.height, size.height) }),
    { width: 0, height: 0 },
  );
}

export interface ZoomInput {
  zoomMode: ZoomMode;
  customScale: number;
  viewMode: ViewMode;
  /** Reference page size in points, as displayed. */
  page: Size;
  viewport: Size;
}

/** Resolves the zoom mode to an actual zoom factor for the given viewport. */
export function resolveZoom({ zoomMode, customScale, viewMode, page, viewport }: ZoomInput): number {
  if (zoomMode === 'custom') return clampZoom(customScale);
  if (page.width <= 0 || page.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return 1;

  const columns = viewMode === 'twoPage' ? 2 : 1;
  const availableWidth = viewport.width - VIEWER_PADDING * 2 - PAGE_GAP * (columns - 1);
  const availableHeight = viewport.height - VIEWER_PADDING * 2;
  const widthZoom = availableWidth / (page.width * columns * CSS_PIXELS_PER_POINT);
  const heightZoom = availableHeight / (page.height * CSS_PIXELS_PER_POINT);
  return clampZoom(zoomMode === 'fitWidth' ? widthZoom : Math.min(widthZoom, heightZoom));
}

export function formatZoom(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}
