import {
  documentFileKind,
  type Attachment,
  type Bookmark,
  type DocumentFileKind,
  type DocumentModel,
  type DocumentProtection,
  type OpenedFile,
  type OpenFileResult,
  type PageModel,
  type RecognisedText,
  type ViewMode,
  type ZoomMode,
} from '@shared/types/document';
import { ProjectError } from '@shared/schemas/project';
import type { PageLayers } from '@shared/types/layers';
import type { PageObjects } from '@shared/types/objects';
import { ExportError } from '../../engine/export/buildPdf';
import { exportPages } from '../../engine/export/exportService';
import { bookmarksFromOutline } from '../../engine/bookmarks/bookmarkOperations';
import { chunkPages, createBlankPage, insertPages, pageSizeForImage } from '../../engine/document/pageOperations';
import { importAnnotations } from '../../engine/pdf/importAnnotations';
import { PdfLoadError, type PdfSource } from '../../engine/pdf/types';
import { hasRestrictedSource, registerFile, registerImageAsset, registerPdfSource, releaseDocument } from '../../engine/rendering/pageRenderer';
import { clampZoom, stepZoom } from '../../engine/rendering/zoom';
import { i18n } from '../../localization/i18n';
import { getActiveDocument, getDocument, useDocumentsStore } from '../../stores/documentsStore';
import { useUiStore } from '../../stores/uiStore';
import { loadProject, serialiseDocument } from '../project/projectActions';
import { createDocument, decodeImageFile, loadSource, newId } from './documentFactory';

export { setImageDecoder, setPdfLoader } from './documentFactory';

const t = (key: string, options: Record<string, unknown> = {}): string => i18n.t(key, options);
const store = () => useDocumentsStore.getState();
const ui = () => useUiStore.getState();

async function withBusy<T>(work: () => Promise<T>): Promise<T> {
  ui().beginBusy();
  try {
    return await work();
  } finally {
    ui().endBusy();
  }
}

/** Parses PDF bytes produced by the application itself (e.g. to rasterise an export). */
export function loadPdfSource(data: Uint8Array): Promise<PdfSource> {
  return loadSource(data, async () => null);
}

// --- Loading resources ---------------------------------------------------------------------

interface LoadedPages {
  /** Everything registered for this file: page sources, images, attachment bytes. */
  resourceIds: string[];
  pages: PageModel[];
  /** Outline of the source file, already pointing at the new pages. */
  bookmarks: Bookmark[];
  /** Comments and links of the source file as editable objects, with the layers they are on. */
  objects: PageObjects;
  layers: PageLayers;
  attachments: Attachment[];
  /** Recognised text; only project files carry it. */
  recognised: RecognisedText;
  /** Set when the file was opened with a password: saved PDFs keep that password. */
  protection: DocumentProtection | null;
}

/** Parses a PDF file and registers it as a page source. Throws `PdfLoadError`. */
async function loadPdfPages(file: OpenedFile): Promise<LoadedPages> {
  // PDF.js takes ownership of the buffer it is given, so the copy kept for saving is made first.
  const bytes = file.data.slice();
  const source = await loadSource(file.data, (reason) => ui().requestPassword(file.name, reason));
  try {
    const resourceId = newId();
    const pages: PageModel[] = [];
    for (let pageIndex = 0; pageIndex < source.pageCount; pageIndex += 1) {
      const info = await source.getPageInfo(pageIndex);
      pages.push({
        id: newId(),
        source: { kind: 'pdf', sourceId: resourceId, pageIndex },
        box: info.box,
        rotation: info.rotation,
      });
    }
    // A file with a broken outline still opens; it just has no bookmarks.
    const outline = await source.getOutline().catch(() => []);
    const pageIdAt = (pageIndex: number): string | null => pages[pageIndex]?.id ?? null;
    const bookmarks = bookmarksFromOutline(outline, pageIdAt, newId);

    // Comments and links become editable objects; everything else stays part of the page.
    const objects: PageObjects = {};
    const layers: PageLayers = {};
    const taken: Record<number, number[]> = {};
    for (const [pageIndex, page] of pages.entries()) {
      const annotations = await source.getAnnotations(pageIndex).catch(() => []);
      if (annotations.length === 0) continue;
      const imported = importAnnotations(annotations, pageIdAt, newId, t('layers.defaults.annotation'));
      if (!imported.layer) continue;
      objects[page.id] = imported.objects;
      layers[page.id] = [imported.layer];
      taken[pageIndex] = imported.taken;
    }

    const attachments: Attachment[] = [];
    for (const file of await source.getAttachments().catch(() => [])) {
      const fileId = newId();
      registerFile(fileId, file.data);
      attachments.push({ id: newId(), name: file.name, size: file.data.length, resourceId: fileId });
    }

    registerPdfSource(resourceId, source, bytes, taken);
    return {
      resourceIds: [resourceId, ...attachments.map((attachment) => attachment.resourceId)],
      pages,
      bookmarks,
      objects,
      layers,
      attachments,
      recognised: {},
      protection: source.protection?.password ? { password: source.protection.password } : null,
    };
  } catch (error) {
    await source.destroy().catch(() => undefined);
    throw error;
  }
}

async function loadImagePage(file: OpenedFile): Promise<LoadedPages> {
  const decoded = await decodeImageFile(file.name, file.data);
  const resourceId = newId();
  registerImageAsset(resourceId, decoded);
  const page = createBlankPage(newId, pageSizeForImage(decoded.bitmap.width, decoded.bitmap.height));
  return {
    resourceIds: [resourceId],
    pages: [{ ...page, source: { kind: 'image', assetId: resourceId } }],
    bookmarks: [],
    objects: {},
    layers: {},
    attachments: [],
    recognised: {},
    protection: null,
  };
}

/** Loads a document file of either kind: a PDF, or a project with its editable content. */
async function loadDocumentFile(file: OpenedFile): Promise<LoadedPages> {
  if (documentFileKind(file.name) !== 'project') return loadPdfPages(file);
  const project = await loadProject(file.data, file.name);
  return { resourceIds: project.resourceIds, pages: project.pages, ...project.content, protection: project.protection };
}

/** Loads several files, collecting a readable problem line for each one that fails. */
async function loadAll(
  results: OpenFileResult[],
  load: (file: OpenedFile) => Promise<LoadedPages>,
  fallbackError: string,
): Promise<{ loaded: Array<LoadedPages & { file: OpenedFile }>; problems: string[] }> {
  const loaded: Array<LoadedPages & { file: OpenedFile }> = [];
  const problems: string[] = [];
  for (const result of results) {
    if (!result.ok) {
      problems.push(`${result.name}: ${t(`errors.open.${result.error}`)}`);
      continue;
    }
    try {
      loaded.push({ ...(await load(result.file)), file: result.file });
    } catch (error) {
      const code = error instanceof PdfLoadError || error instanceof ProjectError ? error.code : fallbackError;
      // Cancelling the password prompt is the user's choice, not an error.
      if (code === 'cancelled') continue;
      if (!(error instanceof PdfLoadError || error instanceof ProjectError) || code === 'unknown') console.error(error);
      problems.push(`${result.file.name}: ${t(`errors.open.${code}`)}`);
    }
  }
  return { loaded, problems };
}

function reportProblems(problems: string[], titleKey = 'errors.openTitle'): void {
  if (problems.length > 0) ui().showNotice({ titleKey, lines: problems });
}

function untitledName(): string {
  const taken = new Set(store().documents.map((document) => document.name));
  for (let number = 1; ; number += 1) {
    const name = number === 1 ? `${t('documents.untitled')}.pdf` : `${t('documents.untitled')} ${number}.pdf`;
    if (!taken.has(name)) return name;
  }
}

// --- Opening and closing -------------------------------------------------------------------

/** Turns file-read results into open documents and reports every failure to the user. */
export async function openFileResults(results: OpenFileResult[]): Promise<void> {
  const fresh: OpenFileResult[] = [];
  for (const result of results) {
    const alreadyOpen = result.ok && store().documents.find((document) => document.path === result.file.path);
    if (alreadyOpen) store().setActive(alreadyOpen.id);
    else fresh.push(result);
  }
  if (fresh.length === 0) return;

  const { loaded, problems } = await withBusy(() => loadAll(fresh, loadDocumentFile, 'unknown'));
  for (const { file, pages, resourceIds, ...content } of loaded) {
    store().add(createDocument(file.name, file.path, pages, resourceIds, true, content));
    // Only documents that really opened are remembered.
    await window.api.recent.add(file.path).catch(() => undefined);
  }
  reportProblems(problems);
}

export async function openWithDialog(): Promise<void> {
  await openFileResults(await window.api.documents.openDialog());
}

export async function openPaths(paths: string[]): Promise<void> {
  if (paths.length > 0) await openFileResults(await window.api.documents.openPaths(paths));
}

/** Opens files dropped onto the window. Non-PDF files are reported by the main process. */
export async function openDroppedFiles(files: Iterable<File>): Promise<void> {
  const paths = [...files].map((file) => window.api.documents.getPathForFile(file)).filter((path) => path !== '');
  await openPaths(paths);
}

export function newDocument(): void {
  // An untouched blank document has nothing to lose, so it starts out unmodified.
  store().add(createDocument(untitledName(), null, [createBlankPage(newId)], [], true));
}

/** Closes a document, offering to save unsaved changes first. Returns false when the user cancels. */
export async function closeDocument(id: string): Promise<boolean> {
  const document = getDocument(id);
  if (!document) return true;
  if (document.modified) {
    store().setActive(id);
    const answer = await ui().confirm({
      title: t('dialogs.unsavedClose.title'),
      message: t('dialogs.unsavedClose.message', { name: document.name }),
      confirmLabel: t('commands.file.save'),
      alternativeLabel: t('dialogs.unsavedClose.discard'),
    });
    if (answer === 'cancel') return false;
    if (answer === 'confirm' && !(await saveDocument(id))) return false;
  }
  store().remove(id);
  await releaseDocument(id, document.resourceIds);
  return true;
}

// --- Page operations (all undoable) ----------------------------------------------------------

/** Pages an operation applies to: the thumbnail selection, or the current page when nothing is selected. */
export function targetPageIds(document: DocumentModel): Set<string> {
  if (document.selection.length > 0) return new Set(document.selection);
  const current = document.pages[document.view.currentPage];
  return new Set(current ? [current.id] : []);
}

/** Index right after the last target page: where new pages are inserted. */
function insertionIndex(document: DocumentModel): number {
  const targets = targetPageIds(document);
  const last = document.pages.findLastIndex((page) => targets.has(page.id));
  return last === -1 ? document.pages.length : last + 1;
}

async function importInto(
  results: OpenFileResult[],
  load: (file: OpenedFile) => Promise<LoadedPages>,
  fallbackError: string,
  newDocumentName: () => string,
): Promise<void> {
  if (results.length === 0) return;
  const target = getActiveDocument();
  const { loaded, problems } = await withBusy(() => loadAll(results, load, fallbackError));
  const pages = loaded.flatMap((item) => item.pages);
  const resourceIds = loaded.flatMap((item) => item.resourceIds);
  const objects = Object.assign({}, ...loaded.map((item) => item.objects)) as PageObjects;
  const layers = Object.assign({}, ...loaded.map((item) => item.layers)) as PageLayers;
  const recognised = Object.assign({}, ...loaded.map((item) => item.recognised)) as RecognisedText;

  if (pages.length > 0) {
    // The target may have been closed while files were loading.
    const document = target && getDocument(target.id);
    if (document) {
      store().addResources(document.id, resourceIds);
      store().commit(document.id, {
        pages: insertPages(document.pages, insertionIndex(document), pages),
        // Comments and links of the inserted pages come along with them.
        objects: Object.keys(objects).length > 0 ? { ...document.objects, ...objects } : undefined,
        layers: Object.keys(layers).length > 0 ? { ...document.layers, ...layers } : undefined,
        recognised: Object.keys(recognised).length > 0 ? { ...document.recognised, ...recognised } : undefined,
        selection: pages.map((page) => page.id),
      });
    } else {
      store().add(createDocument(newDocumentName(), null, pages, resourceIds, false, { objects, layers, recognised }));
    }
  }
  reportProblems(problems);
}

/** Inserts all pages of the chosen PDF files after the current selection. */
export async function insertPagesFromPdf(): Promise<void> {
  await importInto(await window.api.documents.openDialog(), loadDocumentFile, 'unknown', untitledName);
}

/** Adds each chosen image as a page of its own (or starts a new document from them). */
export async function importImagesAsPages(): Promise<void> {
  await importInto(await window.api.documents.openImagesDialog(), loadImagePage, 'badImage', untitledName);
}

/** Combines the chosen PDF files into one new, unsaved document. */
export async function mergeDocuments(): Promise<void> {
  const results = await window.api.documents.openDialog();
  if (results.length === 0) return;
  const { loaded, problems } = await withBusy(() => loadAll(results, loadDocumentFile, 'unknown'));
  if (loaded.length > 0) {
    // Each merged file becomes a top-level bookmark holding that file's own outline.
    const bookmarks: Bookmark[] = loaded.map((item) => ({
      id: newId(),
      title: documentStem(item.file.name),
      pageId: item.pages[0]?.id ?? null,
      children: item.bookmarks,
    }));
    store().add(
      createDocument(
        untitledName(),
        null,
        loaded.flatMap((item) => item.pages),
        loaded.flatMap((item) => item.resourceIds),
        false,
        {
          bookmarks,
          objects: Object.assign({}, ...loaded.map((item) => item.objects)) as PageObjects,
          layers: Object.assign({}, ...loaded.map((item) => item.layers)) as PageLayers,
          attachments: loaded.flatMap((item) => item.attachments),
          recognised: Object.assign({}, ...loaded.map((item) => item.recognised)) as RecognisedText,
        },
      ),
    );
  }
  reportProblems(problems);
}

// --- Saving --------------------------------------------------------------------------------

function exportErrorMessage(error: unknown): string {
  if (error instanceof ExportError && error.code !== 'failed') return t(`errors.save.${error.code}`);
  if (error instanceof ProjectError) return t('errors.save.projectFailed');
  console.error(error);
  return t('errors.save.failed');
}

/** Refuses to copy pages out of a file whose owner restricted changes and copying. */
export function assertWritable(pages: readonly PageModel[]): void {
  if (hasRestrictedSource(pages)) throw new ExportError('restrictedSource');
}

/** What gets written: a page list plus the document-level content that goes with it. */
type Content = Pick<DocumentModel, 'name' | 'pages' | 'objects' | 'layers' | 'bookmarks' | 'attachments' | 'recognised' | 'protection'>;

/**
 * Generates the file (a PDF, or a project that keeps everything editable) and
 * writes it. Reports failures; returns the written path or `null`.
 */
async function writePages(
  content: Content,
  write: (bytes: Uint8Array) => ReturnType<typeof window.api.documents.writeFile>,
  label: string,
  kind: DocumentFileKind = 'pdf',
): Promise<string | null> {
  try {
    if (kind === 'pdf') assertWritable(content.pages);
    const bytes = kind === 'project' ? await serialiseDocument(content) : await exportPages(content);
    const result = await write(bytes);
    if (result.ok) return result.path;
    reportProblems([`${label}: ${t(`errors.save.${result.error}`)}`], 'errors.saveTitle');
  } catch (error) {
    reportProblems([`${label}: ${exportErrorMessage(error)}`], 'errors.saveTitle');
  }
  return null;
}

const fileNameOf = (path: string): string => path.split(/[\\/]/).pop() ?? path;

async function saveTo(id: string, path: string, adopt: boolean): Promise<boolean> {
  const document = getDocument(id);
  if (!document) return false;
  const { pages, objects, layers, bookmarks, attachments, recognised, protection } = document;
  const written = await withBusy(() =>
    writePages(
      // The file records the name it is saved under, not the one the document had before.
      { name: fileNameOf(path), pages, objects, layers, bookmarks, attachments, recognised, protection },
      (bytes) => window.api.documents.writeFile(path, bytes),
      fileNameOf(path),
      documentFileKind(path),
    ),
  );
  if (!written) return false;
  if (adopt) {
    // Only the state that was actually written counts as saved.
    const current = getDocument(id);
    if (
      current?.pages === pages &&
      current.objects === objects &&
      current.layers === layers &&
      current.bookmarks === bookmarks &&
      current.attachments === attachments &&
      current.recognised === recognised &&
      current.protection === protection
    ) {
      store().markSaved(id, { path: written, name: fileNameOf(written) });
    }
    await window.api.recent.add(written).catch(() => undefined);
  }
  return true;
}

/** Name of a document without its `.pdf` / `.pdfproject` extension. */
export const documentStem = (name: string): string => name.replace(/\.(pdf|pdfproject)$/i, '');

/**
 * Asks where to save and makes that file the document's own. By default the
 * document keeps its kind: a PDF stays a PDF, a project stays a project.
 */
export async function saveDocumentAs(id = getActiveDocument()?.id, kind?: DocumentFileKind): Promise<boolean> {
  const document = id ? getDocument(id) : null;
  if (!document) return false;
  const targetKind = kind ?? documentFileKind(document.path ?? document.name);
  const path = await window.api.documents.saveDialog(document.path ?? document.name, targetKind);
  return path ? saveTo(document.id, path, true) : false;
}

/** Saves the document as a project file, which keeps objects, layers and recognised text editable. */
export function saveDocumentAsProject(): Promise<boolean> {
  return saveDocumentAs(getActiveDocument()?.id, 'project');
}

export async function saveDocument(id = getActiveDocument()?.id): Promise<boolean> {
  const document = id ? getDocument(id) : null;
  if (!document) return false;
  return document.path ? saveTo(document.id, document.path, true) : saveDocumentAs(document.id);
}

/**
 * Writes the current state to another file without changing where the document
 * itself is saved. The copy is of the document's own kind unless `kind` says otherwise.
 */
export async function saveDocumentCopy(kind?: DocumentFileKind): Promise<boolean> {
  const document = getActiveDocument();
  if (!document) return false;
  const targetKind = kind ?? documentFileKind(document.path ?? document.name);
  const suggested = `${documentStem(document.name)} ${t('documents.copySuffix')}`;
  const path = await window.api.documents.saveDialog(suggested, targetKind);
  return path ? saveTo(document.id, path, false) : false;
}

/** Writes a standard PDF next to a document of any kind. */
export async function exportDocumentAsPdf(): Promise<boolean> {
  const document = getActiveDocument();
  if (!document) return false;
  // A PDF document is exported under a new name; a project simply under its own.
  const suffix = documentFileKind(document.path ?? document.name) === 'pdf' ? ` ${t('documents.copySuffix')}` : '';
  const path = await window.api.documents.saveDialog(`${documentStem(document.name)}${suffix}`, 'pdf');
  return path ? saveTo(document.id, path, false) : false;
}

/** Saves the selected pages as a separate PDF. The document itself is not changed. */
export async function extractSelectedPages(): Promise<boolean> {
  const document = getActiveDocument();
  if (!document) return false;
  const targets = targetPageIds(document);
  const pages = document.pages.filter((page) => targets.has(page.id));
  if (pages.length === 0) return false;
  const path = await window.api.documents.saveDialog(`${documentStem(document.name)} ${t('documents.extractSuffix')}`);
  if (!path) return false;
  const written = await withBusy(() =>
    writePages({ ...document, pages, attachments: [] }, (bytes) => window.api.documents.writeFile(path, bytes), fileNameOf(path)),
  );
  return written !== null;
}

/** Splits the document into files of `pagesPerFile` pages each, written into a folder the user picks. */
export async function splitDocument(pagesPerFile: number): Promise<number> {
  const document = getActiveDocument();
  if (!document) return 0;
  const chunks = chunkPages(document.pages, pagesPerFile);
  const directory = await window.api.documents.chooseDirectory();
  if (!directory) return 0;

  const stem = documentStem(document.name);
  const digits = String(chunks.length).length;
  const created: string[] = [];
  await withBusy(async () => {
    for (const [index, pages] of chunks.entries()) {
      const fileName = `${stem}-${String(index + 1).padStart(digits, '0')}.pdf`;
      const written = await writePages(
        { ...document, pages, attachments: [] },
        (bytes) => window.api.documents.writeToDirectory(directory, fileName, bytes),
        fileName,
      );
      // Stop at the first failure: the cause (disk full, no permission) will repeat.
      if (!written) return;
      created.push(written);
    }
  });
  if (created.length > 0) {
    ui().showNotice({
      titleKey: 'dialogs.split.doneTitle',
      lines: [t('dialogs.split.done', { count: created.length, directory }), ...created.map(fileNameOf)],
    });
  }
  return created.length;
}

// --- View actions on the active document -----------------------------------------------------

export function goToPage(pageIndex: number, documentId = getActiveDocument()?.id): void {
  const document = documentId ? getDocument(documentId) : null;
  if (!document || document.pages.length === 0) return;
  const currentPage = Math.min(Math.max(Math.trunc(pageIndex), 0), document.pages.length - 1);
  store().updateView(document.id, { currentPage, navigationSeq: document.view.navigationSeq + 1 });
}

/** Number of pages one "next page" step advances in the given view mode. */
export function pageStep(viewMode: ViewMode): number {
  return viewMode === 'twoPage' ? 2 : 1;
}

export function goToRelativePage(direction: 1 | -1): void {
  const document = getActiveDocument();
  if (!document) return;
  const step = pageStep(document.view.viewMode);
  // In two-page mode navigation always lands on the left page of a spread.
  const base = document.view.currentPage - (document.view.currentPage % step);
  goToPage(base + direction * step);
}

export function setZoomMode(zoomMode: Exclude<ZoomMode, 'custom'>): void {
  const document = getActiveDocument();
  if (document) store().updateView(document.id, { zoomMode });
}

export function setCustomZoom(zoom: number, documentId = getActiveDocument()?.id): void {
  if (!documentId || !Number.isFinite(zoom)) return;
  store().updateView(documentId, { zoomMode: 'custom', customScale: clampZoom(zoom) });
}

export function zoomStep(direction: 1 | -1): void {
  const document = getActiveDocument();
  if (document) setCustomZoom(stepZoom(document.view.effectiveZoom, direction), document.id);
}

export function setViewMode(viewMode: ViewMode): void {
  const document = getActiveDocument();
  if (!document) return;
  store().updateView(document.id, {
    viewMode,
    // Keep the current page in view after the layout changes.
    navigationSeq: document.view.navigationSeq + 1,
  });
}
