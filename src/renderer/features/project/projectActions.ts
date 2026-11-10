import { ProjectError, type ProjectModel } from '@shared/schemas/project';
import type { DocumentModel, DocumentProtection, PageModel } from '@shared/types/document';
import { ExportError } from '../../engine/export/buildPdf';
import type { PdfSource } from '../../engine/pdf/types';
import { remapResourceIds, type ProjectFiles } from '../../engine/project/projectArchive';
import { packProject, unpackProject } from '../../engine/project/projectService';
import {
  getFileBytes,
  getImageAsset,
  getSourceBytes,
  getTakenAnnotations,
  registerFile,
  registerImageAsset,
  registerPdfSource,
  releaseDocument,
} from '../../engine/rendering/pageRenderer';
import { useUiStore } from '../../stores/uiStore';
import { decodeImageFile, loadSource, newId, type InitialContent } from '../documents/documentFactory';

/** Turning open documents into `.pdfproject` archives and back. */

export type ProjectContent = Pick<DocumentModel, 'name' | 'pages' | 'objects' | 'layers' | 'bookmarks' | 'attachments' | 'recognised'>;

let appVersion: Promise<string> | null = null;
const getAppVersion = (): Promise<string> =>
  (appVersion ??= window.api.app.getInfo().then(
    (info) => info.version,
    () => '',
  ));

/**
 * Packs the editable state of a document together with everything it refers
 * to: the source PDFs, images and attachments. Nothing is flattened, so the
 * project reopens exactly as it was.
 */
export async function serialiseDocument(document: ProjectContent): Promise<Uint8Array> {
  const files: ProjectFiles = { sources: {}, assets: {}, attachments: {} };
  const sources: ProjectModel['sources'] = [];
  const assets: ProjectModel['assets'] = [];

  const addSource = (id: string): void => {
    if (files.sources[id]) return;
    const bytes = getSourceBytes(id);
    if (!bytes) throw new ExportError('missingResource');
    files.sources[id] = bytes;
    sources.push({ id, takenAnnotations: getTakenAnnotations(id) });
  };
  const addAsset = (id: string): void => {
    if (files.assets[id]) return;
    const asset = getImageAsset(id);
    if (!asset) throw new ExportError('missingResource');
    files.assets[id] = asset.bytes;
    assets.push({ id, mime: asset.mime });
  };

  // Only what the current state uses is stored; resources kept alive just for undo are not.
  for (const page of document.pages) {
    if (page.source.kind === 'pdf') addSource(page.source.sourceId);
    else if (page.source.kind === 'image') addAsset(page.source.assetId);
  }
  const pageIds = new Set(document.pages.map((page) => page.id));
  const ofPages = <T>(record: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(record).filter(([pageId]) => pageIds.has(pageId)));
  const objects = ofPages(document.objects);
  for (const object of Object.values(objects).flat()) {
    if (object.type === 'image') addAsset(object.assetId);
  }
  for (const attachment of document.attachments) {
    const bytes = getFileBytes(attachment.resourceId);
    if (!bytes) throw new ExportError('missingResource');
    files.attachments[attachment.resourceId] = bytes;
  }

  const model: ProjectModel = {
    pages: document.pages,
    objects,
    layers: ofPages(document.layers),
    bookmarks: document.bookmarks,
    attachments: document.attachments,
    recognised: ofPages(document.recognised),
    sources,
    assets,
  };
  return packProject(document.name, await getAppVersion(), model, files);
}

export interface LoadedProject {
  pages: PageModel[];
  content: Required<Omit<InitialContent, 'protection'>>;
  resourceIds: string[];
  /** Password of a protected source inside the project, as typed by the user. */
  protection: DocumentProtection | null;
}

/**
 * Reads a project archive and registers its resources. The archive is
 * untrusted: its structure is validated, every source PDF goes through the
 * ordinary PDF loader (asking for a password where one is needed), and page
 * references are checked against what the sources really contain.
 *
 * Throws `ProjectError` or `PdfLoadError`; nothing stays registered on failure.
 */
export async function loadProject(data: Uint8Array, fileName: string): Promise<LoadedProject> {
  const contents = remapResourceIds(await unpackProject(data), newId);
  const { model } = contents;
  const registered: string[] = [];
  let protection: DocumentProtection | null = null;
  let pending: PdfSource | null = null;
  try {
    for (const { id, takenAnnotations } of model.sources) {
      const bytes = contents.sources[id]!;
      // The loader takes ownership of its buffer; the original bytes are kept for saving.
      pending = await loadSource(bytes.slice(), (reason) => useUiStore.getState().requestPassword(fileName, reason));
      const pageCount = pending.pageCount;
      const valid = model.pages.every(
        (page) => page.source.kind !== 'pdf' || page.source.sourceId !== id || page.source.pageIndex < pageCount,
      );
      if (!valid) throw new ProjectError('corruptProject');
      const taken: Record<number, number[]> = {};
      for (const [pageIndex, numbers] of Object.entries(takenAnnotations)) taken[Number(pageIndex)] = numbers;
      if (pending.protection?.password) protection ??= { password: pending.protection.password };
      registerPdfSource(id, pending, bytes, taken);
      pending = null;
      registered.push(id);
    }
    for (const { id, mime } of model.assets) {
      let decoded;
      try {
        decoded = await decodeImageFile(mime === 'image/png' ? 'asset.png' : 'asset.jpg', contents.assets[id]!);
      } catch (error) {
        throw new ProjectError('corruptProject', error);
      }
      registerImageAsset(id, decoded);
      registered.push(id);
    }
    for (const attachment of model.attachments) {
      registerFile(attachment.resourceId, contents.attachments[attachment.resourceId]!);
      registered.push(attachment.resourceId);
    }
  } catch (error) {
    await pending?.destroy().catch(() => undefined);
    await releaseDocument('', registered);
    throw error;
  }
  return {
    pages: model.pages,
    content: {
      objects: model.objects,
      layers: model.layers,
      bookmarks: model.bookmarks,
      attachments: model.attachments,
      recognised: model.recognised,
    },
    resourceIds: registered,
    protection,
  };
}
