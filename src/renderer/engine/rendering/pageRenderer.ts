import type { PageModel } from '@shared/types/document';
import { RenderCancelledError, type PdfSource, type RenderJob, type SourceProtection, type TextRun } from '../pdf/types';
import { BitmapCache } from './bitmapCache';

/** About 190 MB of RGBA pixels shared by all open documents. */
const CACHE_PIXEL_BUDGET = 48_000_000;
const MAX_IMAGE_PAGE_PIXELS = 4096 * 4096;

interface PdfResource {
  kind: 'pdf';
  source: PdfSource;
  /** Untouched file bytes, needed to copy pages when the document is saved. */
  bytes: Uint8Array;
  /**
   * Object numbers of the annotations that were turned into editable objects, per page
   * index. They are left out when pages of this file are copied on save.
   */
  takenAnnotations: Record<number, number[]>;
}

interface FileResource {
  kind: 'file';
  bytes: Uint8Array;
}

export interface ImageAsset {
  kind: 'image';
  /** PNG or JPEG bytes, embeddable into a PDF as they are. */
  bytes: Uint8Array;
  mime: 'image/png' | 'image/jpeg';
  bitmap: ImageBitmap;
  /** Object URL of the bytes, for `<image>` elements on the editing canvas. */
  url: string;
}

/**
 * Resources (parsed PDFs, imported images) live here, outside React state:
 * they are large, not serialisable and have an explicit lifetime.
 */
const resources = new Map<string, PdfResource | ImageAsset | FileResource>();
const cache = new BitmapCache<ImageBitmap>(CACHE_PIXEL_BUDGET);

export function registerPdfSource(
  id: string,
  source: PdfSource,
  bytes: Uint8Array,
  takenAnnotations: Record<number, number[]> = {},
): void {
  resources.set(id, { kind: 'pdf', source, bytes, takenAnnotations });
}

export function getTakenAnnotations(id: string): Record<number, number[]> {
  const resource = resources.get(id);
  return resource?.kind === 'pdf' ? resource.takenAnnotations : {};
}

/** How a protected source was opened, or `null` for ordinary files. */
export function getSourceProtection(id: string): SourceProtection | null {
  const resource = resources.get(id);
  return resource?.kind === 'pdf' ? (resource.source.protection ?? null) : null;
}

/**
 * True when any of the pages comes from a file whose owner did not permit
 * changing or copying it. Such pages are shown but never written out again.
 */
export function hasRestrictedSource(pages: readonly PageModel[]): boolean {
  return pages.some((page) => page.source.kind === 'pdf' && getSourceProtection(page.source.sourceId)?.restricted === true);
}

/** Keeps the bytes of an attached file. */
export function registerFile(id: string, bytes: Uint8Array): void {
  resources.set(id, { kind: 'file', bytes });
}

export function getFileBytes(id: string): Uint8Array | undefined {
  const resource = resources.get(id);
  return resource?.kind === 'file' ? resource.bytes : undefined;
}

export function registerImageAsset(id: string, asset: Omit<ImageAsset, 'kind' | 'url'>): void {
  const url =
    typeof URL.createObjectURL === 'function' ? URL.createObjectURL(new Blob([asset.bytes.slice()], { type: asset.mime })) : '';
  resources.set(id, { kind: 'image', ...asset, url });
}

export function getSourceBytes(id: string): Uint8Array | undefined {
  const resource = resources.get(id);
  return resource?.kind === 'pdf' ? resource.bytes : undefined;
}

export function getImageAsset(id: string): ImageAsset | undefined {
  const resource = resources.get(id);
  return resource?.kind === 'image' ? resource : undefined;
}

const textRunCache = new Map<string, Promise<TextRun[]>>();

/** Lines of text on a source page (cached), for the "edit text" tool. */
export function getTextRuns(sourceId: string, pageIndex: number): Promise<TextRun[]> {
  const resource = resources.get(sourceId);
  if (resource?.kind !== 'pdf') return Promise.resolve([]);
  const key = `${sourceId}:${pageIndex}`;
  let runs = textRunCache.get(key);
  if (!runs) {
    runs = resource.source.getTextRuns(pageIndex);
    textRunCache.set(key, runs);
  }
  return runs;
}

export function hasResource(id: string): boolean {
  return resources.has(id);
}

/** Frees the resources of a closed document and its cached page images. */
export async function releaseDocument(documentId: string, resourceIds: readonly string[]): Promise<void> {
  cache.deleteByPrefix(`${documentId}:`);
  for (const id of resourceIds) {
    const resource = resources.get(id);
    resources.delete(id);
    for (const key of [...textRunCache.keys()]) if (key.startsWith(`${id}:`)) textRunCache.delete(key);
    if (resource?.kind === 'pdf') await resource.source.destroy().catch(() => undefined);
    else if (resource?.kind === 'image') {
      resource.bitmap.close?.();
      if (resource.url) URL.revokeObjectURL(resource.url);
    }
  }
}

function renderImagePage(asset: ImageAsset, page: PageModel, pixelsPerPoint: number): Promise<ImageBitmap> {
  const quarterTurn = page.rotation === 90 || page.rotation === 270;
  let width = (quarterTurn ? page.box.height : page.box.width) * pixelsPerPoint;
  let height = (quarterTurn ? page.box.width : page.box.height) * pixelsPerPoint;
  const excess = Math.sqrt((width * height) / MAX_IMAGE_PAGE_PIXELS);
  if (excess > 1) {
    width /= excess;
    height /= excess;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(width));
  canvas.height = Math.max(1, Math.floor(height));
  const context = canvas.getContext('2d');
  if (!context) return Promise.reject(new Error('Canvas 2D context is unavailable'));

  // Draw the image filling the unrotated page, rotated clockwise around the canvas centre.
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((page.rotation * Math.PI) / 180);
  const drawWidth = quarterTurn ? canvas.height : canvas.width;
  const drawHeight = quarterTurn ? canvas.width : canvas.height;
  context.drawImage(asset.bitmap, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  return createImageBitmap(canvas).finally(() => {
    canvas.width = 0;
    canvas.height = 0;
  });
}

/**
 * Rasterises one page at the given resolution, reusing a cached bitmap when
 * the same page was rendered at the same size before. Blank pages need no
 * bitmap and are handled by the caller.
 */
export function renderPage(documentId: string, page: PageModel, pixelsPerPoint: number): RenderJob {
  // Quantise so that sub-pixel zoom differences share a cache entry.
  const resolution = Math.round(pixelsPerPoint * 100) / 100;
  const key = `${documentId}:${page.id}:${page.rotation}:${resolution}`;
  const idle = { cancel: () => undefined };

  const cached = cache.get(key);
  if (cached) return { promise: Promise.resolve(cached), ...idle };

  const resourceId =
    page.source.kind === 'pdf' ? page.source.sourceId : page.source.kind === 'image' ? page.source.assetId : null;
  const resource = resourceId ? resources.get(resourceId) : undefined;
  if (!resourceId || !resource) return { promise: Promise.reject(new RenderCancelledError()), ...idle };

  const remember = (bitmap: ImageBitmap): ImageBitmap => {
    // The document may have been closed while the page was rendering.
    if (resources.get(resourceId) === resource) cache.set(key, bitmap);
    return bitmap;
  };

  if (resource.kind === 'image') {
    return { promise: renderImagePage(resource, page, resolution).then(remember), ...idle };
  }
  if (page.source.kind !== 'pdf' || resource.kind !== 'pdf') return { promise: Promise.reject(new RenderCancelledError()), ...idle };

  const job = resource.source.render({
    sourcePageIndex: page.source.pageIndex,
    rotation: page.rotation,
    pixelsPerPoint: resolution,
  });
  return { promise: job.promise.then(remember), cancel: job.cancel };
}
