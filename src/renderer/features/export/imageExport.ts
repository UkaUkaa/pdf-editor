import { ExportError } from '../../engine/export/buildPdf';
import { i18n } from '../../localization/i18n';
import { exportPages } from '../../engine/export/exportService';
import { getActiveDocument } from '../../stores/documentsStore';
import { useUiStore } from '../../stores/uiStore';
import { assertWritable, loadPdfSource } from '../documents/documentActions';
import { pagesInScope, type StampScope } from '../stamps/stampActions';

export type ImageFormat = 'png' | 'jpeg';
export const IMAGE_RESOLUTIONS = [72, 150, 300] as const;

type Encoder = (bitmap: ImageBitmap, format: ImageFormat, quality: number) => Promise<Uint8Array>;

const encodeWithCanvas: Encoder = async (bitmap, format, quality) => {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context is unavailable');
  // Pages are opaque paper; JPEG has no transparency at all.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, format === 'png' ? 'image/png' : 'image/jpeg', quality));
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new Error('Cannot encode the page image');
  return new Uint8Array(await blob.arrayBuffer());
};

let encoder: Encoder = encodeWithCanvas;
/** Test hook: replaces the canvas-based image encoder. */
export function setImageEncoder(next: Encoder | null): void {
  encoder = next ?? encodeWithCanvas;
}

export interface ImageExportOptions {
  format: ImageFormat;
  /** Resolution in dots per inch. */
  dpi: number;
  /** JPEG quality, 0 … 1. */
  quality: number;
  scope: StampScope;
}

/**
 * Saves pages as images into a folder the user picks. The pages are first
 * written exactly as a PDF export would write them and then rasterised from
 * that, so the images show what a reader of the saved file would see.
 * Resolves with the number of files written.
 */
export async function exportImages(options: ImageExportOptions): Promise<number> {
  const document = getActiveDocument();
  if (!document) return 0;
  const pages = pagesInScope(document, options.scope);
  if (pages.length === 0) return 0;
  const directory = await window.api.documents.chooseDirectory();
  if (!directory) return 0;

  const ui = useUiStore.getState();
  const stem = document.name.replace(/\.(pdf|pdfproject)$/i, '');
  const digits = String(document.pages.length).length;
  const written: string[] = [];
  let problem: string | null = null;

  ui.beginBusy();
  try {
    assertWritable(pages);
    // An intermediate file that never leaves memory: it is rendered at once, so it is not encrypted.
    const bytes = await exportPages({ ...document, pages, bookmarks: [], attachments: [], protection: null });
    const source = await loadPdfSource(bytes);
    try {
      for (const [index, page] of pages.entries()) {
        const info = await source.getPageInfo(index);
        const bitmap = await source.render({ sourcePageIndex: index, rotation: info.rotation, pixelsPerPoint: options.dpi / 72 }).promise;
        const data = await encoder(bitmap, options.format, options.quality);
        bitmap.close?.();
        const number = String(document.pages.indexOf(page) + 1).padStart(digits, '0');
        const result = await window.api.documents.writeImage(directory, `${stem}-${number}.${options.format === 'png' ? 'png' : 'jpg'}`, data);
        if (!result.ok) {
          problem = i18n.t(`errors.save.${result.error}`);
          break;
        }
        written.push(result.path.split(/[\\/]/).pop() ?? result.path);
      }
    } finally {
      await source.destroy().catch(() => undefined);
    }
  } catch (error) {
    if (error instanceof ExportError && error.code !== 'failed') {
      problem = i18n.t(`errors.save.${error.code}`);
    } else {
      console.error(error);
      problem = i18n.t('errors.save.failed');
    }
  } finally {
    ui.endBusy();
  }

  if (problem) ui.showNotice({ titleKey: 'errors.saveTitle', lines: [problem] });
  else ui.showNotice({ titleKey: 'exportImages.doneTitle', lines: [i18n.t('exportImages.done', { count: written.length, directory }), ...written.slice(0, 20)] });
  return written.length;
}
