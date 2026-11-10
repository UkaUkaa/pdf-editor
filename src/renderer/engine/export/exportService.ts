import { ALL_FONT_FILES, fontFileName } from '@shared/fonts';
import type { Attachment, Bookmark, DocumentProtection, PageModel, RecognisedText } from '@shared/types/document';
import type { PageLayers } from '@shared/types/layers';
import type { PageObjects } from '@shared/types/objects';
import { i18n } from '../../localization/i18n';
import { layoutText } from '../objects/textLayout';
import { getFileBytes, getImageAsset, getSourceBytes, getSourceProtection, getTakenAnnotations } from '../rendering/pageRenderer';
import { buildPdf, ExportError, HIDDEN_TEXT_FONT, type ExportInput } from './buildPdf';
import type { ExportWorkerResponse } from './export.worker';
import { toExportBookmarks } from './outline';

/** What is written to a file: a page list and the document content that goes with it. */
export interface ExportContent {
  pages: PageModel[];
  objects?: PageObjects;
  layers?: PageLayers;
  bookmarks?: readonly Bookmark[];
  attachments?: readonly Attachment[];
  recognised?: RecognisedText;
  title?: string;
  /** Password the written PDF is protected with, if any. */
  protection?: DocumentProtection | null;
}

const fontCache = new Map<string, Promise<Uint8Array>>();

/** Loads a bundled font file from the application bundle (never from the network). */
export function loadFontBytes(fileName: string): Promise<Uint8Array> {
  if (!ALL_FONT_FILES.includes(fileName)) return Promise.reject(new ExportError('missingResource'));
  let bytes = fontCache.get(fileName);
  if (!bytes) {
    bytes = fetch(new URL(`./fonts/${fileName}`, document.baseURI))
      .then((response) => {
        if (!response.ok) throw new ExportError('missingResource');
        return response.arrayBuffer();
      })
      .then((buffer) => new Uint8Array(buffer));
    fontCache.set(fileName, bytes);
  }
  return bytes;
}

/** Collects everything the given pages depend on. Only what is referenced is sent to the worker. */
export async function collectExportInput(content: ExportContent): Promise<ExportInput> {
  const { pages, objects = {}, layers = {}, bookmarks = [], attachments = [], recognised = {}, title, protection } = content;
  // Layers belong to pages, so with several pages their names say which page they are on.
  const pagesWithLayers = pages.filter((page) => (objects[page.id]?.length ?? 0) > 0 && layers[page.id]?.length).length;
  const input: Required<Omit<ExportInput, 'title' | 'password'>> & { title?: string; password?: string } = {
    pages,
    sources: {},
    assets: {},
    objects: {},
    layers: {},
    fonts: {},
    textLines: {},
    bookmarks: toExportBookmarks(bookmarks, new Map(pages.map((page, index) => [page.id, index]))),
    takenAnnotations: {},
    attachments: attachments.flatMap((attachment) => {
      const bytes = getFileBytes(attachment.resourceId);
      return bytes ? [{ name: attachment.name, bytes }] : [];
    }),
    hiddenText: {},
    sourcePasswords: {},
    password: protection?.password || undefined,
    title,
  };
  const addAsset = (assetId: string): void => {
    const asset = getImageAsset(assetId);
    if (!asset) throw new ExportError('missingResource');
    input.assets[assetId] = { bytes: asset.bytes, mime: asset.mime };
  };

  for (const page of pages) {
    if (page.source.kind === 'pdf') {
      const bytes = getSourceBytes(page.source.sourceId);
      if (!bytes) throw new ExportError('missingResource');
      input.sources[page.source.sourceId] = bytes;
      input.takenAnnotations[page.source.sourceId] = getTakenAnnotations(page.source.sourceId);
      const sourceProtection = getSourceProtection(page.source.sourceId);
      if (sourceProtection) {
        // The owner of the file did not allow changing or copying it: its pages are not written out.
        if (sourceProtection.restricted) throw new ExportError('restrictedSource');
        input.sourcePasswords[page.source.sourceId] = sourceProtection.password;
      }
    } else if (page.source.kind === 'image') {
      addAsset(page.source.assetId);
    }

    const lines = recognised[page.id];
    if (lines?.length) {
      input.hiddenText[page.id] = lines;
      input.fonts[HIDDEN_TEXT_FONT] ??= await loadFontBytes(HIDDEN_TEXT_FONT);
    }

    const pageObjects = objects[page.id];
    if (!pageObjects?.length) continue;
    input.objects[page.id] = pageObjects;
    const pageLayers = layers[page.id];
    if (pageLayers?.length) {
      const pageNumber = pages.indexOf(page) + 1;
      input.layers[page.id] = pageLayers.map((layer) => ({
        ...layer,
        name: pagesWithLayers > 1 ? i18n.t('layers.exportName', { name: layer.name, page: pageNumber }) : layer.name,
      }));
    }
    for (const object of pageObjects) {
      if (object.type === 'image') addAsset(object.assetId);
      if (object.type !== 'text') continue;
      // The layout used on screen is reused verbatim, so line breaks cannot differ.
      input.textLines[object.id] = layoutText(object).lines.map(({ text, x, baseline }) => ({ text, x, baseline }));
      const fileName = fontFileName(object.fontFamily, object);
      input.fonts[fileName] ??= await loadFontBytes(fileName);
    }
  }
  return input;
}

/** Generates a PDF off the main thread (falls back to inline where workers are unavailable). */
export async function exportPages(content: ExportContent): Promise<Uint8Array> {
  const input = await collectExportInput(content);
  if (typeof Worker === 'undefined') return buildPdf(input);

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<ExportWorkerResponse>) => {
      worker.terminate();
      if (event.data.ok) resolve(event.data.bytes);
      else reject(new ExportError(event.data.error));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new ExportError('failed', event.message));
    };
    // Structured cloning copies the bytes; the originals stay usable for rendering.
    worker.postMessage(input);
  });
}
