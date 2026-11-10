import type { DocumentModel, OpenFileResult, PageModel } from '@shared/types/document';
import type { Layer } from '@shared/types/layers';
import type { EditorObject, TextObject, Tool } from '@shared/types/objects';
import { displaySize, pageGeometry } from '../../engine/coordinates/pageCoordinates';
import { decodeImage } from '../../engine/images/decodeImage';
import {
  DEFAULT_LAYER_TYPE,
  groupObjects,
  isLayerUsable,
  moveObjectsToLayer,
  resolveObjects,
  resolveTargetLayer,
  setObjectsLocked,
  ungroupObjects,
} from '../../engine/layers/layerOperations';
import { alignObjects, distributeObjects, restack, type Alignment, type StackMove } from '../../engine/objects/arrange';
import { cloneObjects, createImageObject, normaliseObject } from '../../engine/objects/factory';
import { registerImageAsset } from '../../engine/rendering/pageRenderer';
import { i18n } from '../../localization/i18n';
import { getActiveDocument, getDocument, useDocumentsStore } from '../../stores/documentsStore';
import { useToolStore } from '../../stores/toolStore';
import { useUiStore } from '../../stores/uiStore';

type ImageDecoder = typeof decodeImage;
let imageDecoder: ImageDecoder = decodeImage;
/** Test hook: replaces the browser image decoder. */
export function setObjectImageDecoder(next: ImageDecoder | null): void {
  imageDecoder = next ?? decodeImage;
}

const store = () => useDocumentsStore.getState();
const EMPTY: EditorObject[] = [];
const NO_LAYERS: Layer[] = [];
const newId = (): string => crypto.randomUUID();
/** Offset (points) applied to pasted and duplicated objects so they do not hide their originals. */
const PASTE_OFFSET = 12;

export function currentPageOf(document: DocumentModel): PageModel | undefined {
  return document.pages[document.view.currentPage];
}

export function layersOnPage(document: DocumentModel, pageId: string): Layer[] {
  return document.layers[pageId] ?? NO_LAYERS;
}

/** Objects that can be selected on the canvas: on a visible, unlocked layer and not locked themselves. */
export function selectableObjects(document: DocumentModel, pageId: string): EditorObject[] {
  const selectable = new Set(
    resolveObjects(layersOnPage(document, pageId), objectsOnPage(document, pageId))
      .filter((entry) => entry.interactive)
      .map((entry) => entry.object.id),
  );
  return objectsOnPage(document, pageId).filter((object) => selectable.has(object.id));
}

export function objectsOnPage(document: DocumentModel, pageId: string): EditorObject[] {
  return document.objects[pageId] ?? EMPTY;
}

/** The selected objects, in stacking order. They always belong to the current page. */
export function selectedObjectsOf(document: DocumentModel): EditorObject[] {
  const page = currentPageOf(document);
  if (!page || document.selectedObjects.length === 0) return EMPTY;
  const ids = new Set(document.selectedObjects);
  return objectsOnPage(document, page.id).filter((object) => ids.has(object.id));
}

function commitPageObjects(
  document: DocumentModel,
  pageId: string,
  objects: EditorObject[],
  options: { selectedObjects?: string[]; coalesceKey?: string; layers?: Layer[] } = {},
): void {
  const { layers, ...rest } = options;
  store().commit(document.id, {
    objects: { ...document.objects, [pageId]: objects },
    layers: layers && layers !== layersOnPage(document, pageId) ? { ...document.layers, [pageId]: layers } : undefined,
    ...rest,
  });
}

/**
 * Appends new objects to a page, giving each one a layer: the layer it already
 * names if that exists and can take objects, otherwise the active layer or the
 * layer of the object's type (created when missing).
 */
function placeObjects(document: DocumentModel, pageId: string, added: readonly EditorObject[]): { objects: EditorObject[]; layers: Layer[] } {
  let layers = layersOnPage(document, pageId);
  const placed = added.map((object) => {
    if (isLayerUsable(layers.find((layer) => layer.id === object.layerId))) return object;
    const type = DEFAULT_LAYER_TYPE[object.type];
    const target = resolveTargetLayer(layers, document.activeLayers[pageId], type, newId, i18n.t(`layers.defaults.${type}`));
    layers = target.layers;
    return { ...object, layerId: target.layerId };
  });
  return { objects: [...objectsOnPage(document, pageId), ...placed], layers };
}

/** Adds an object on top of a page and selects it. Makes that page the current one. */
export function addObject(documentId: string, pageId: string, object: EditorObject): void {
  const document = getDocument(documentId);
  if (!document) return;
  const pageIndex = document.pages.findIndex((page) => page.id === pageId);
  if (pageIndex === -1) return;
  if (pageIndex !== document.view.currentPage) store().updateView(documentId, { currentPage: pageIndex });
  const fresh = getDocument(documentId) ?? document;
  const { objects, layers } = placeObjects(fresh, pageId, [normaliseObject(object)]);
  commitPageObjects(fresh, pageId, objects, { layers, selectedObjects: [object.id] });
}

/**
 * Replaces objects of a page (matched by id) as one undoable step. With a
 * `coalesceKey`, rapid successive edits of the same kind merge into one step.
 */
export function replaceObjects(documentId: string, pageId: string, changed: readonly EditorObject[], coalesceKey?: string): void {
  const document = getDocument(documentId);
  if (!document || changed.length === 0) return;
  const byId = new Map(changed.map((object) => [object.id, normaliseObject(object)]));
  const current = objectsOnPage(document, pageId);
  let different = false;
  const next = current.map((object) => {
    const replacement = byId.get(object.id);
    if (!replacement || replacement === object) return object;
    different = true;
    return replacement;
  });
  if (different) commitPageObjects(document, pageId, next, { coalesceKey });
}

export interface ObjectChange {
  pageId: string;
  /** New objects; each gets a layer like any other new object. */
  add?: EditorObject[];
  /** Existing objects (matched by id) in their new state. */
  replace?: EditorObject[];
}

/** Adds and changes objects on several pages as a single undoable step. */
export function applyObjectChanges(documentId: string, changes: readonly ObjectChange[]): void {
  const document = getDocument(documentId);
  if (!document) return;
  const objects = { ...document.objects };
  const layers = { ...document.layers };
  let changed = false;
  for (const change of changes) {
    if (!document.pages.some((page) => page.id === change.pageId)) continue;
    // Work on the state accumulated so far, in case a page appears in several changes.
    const view = { ...document, objects, layers };
    const replacements = new Map((change.replace ?? []).map((object) => [object.id, normaliseObject(object)]));
    let next = objectsOnPage(view, change.pageId).map((object) => replacements.get(object.id) ?? object);
    if (change.add?.length) {
      const placed = placeObjects({ ...view, objects: { ...objects, [change.pageId]: next } }, change.pageId, change.add.map(normaliseObject));
      next = placed.objects;
      layers[change.pageId] = placed.layers;
    }
    objects[change.pageId] = next;
    changed = true;
  }
  if (changed) store().commit(documentId, { objects, layers });
}

/** Applies a change to every selected object. */
export function updateSelectedObjects(change: (object: EditorObject) => EditorObject, coalesceKey?: string): void {
  const document = getActiveDocument();
  const page = document && currentPageOf(document);
  if (!document || !page) return;
  replaceObjects(document.id, page.id, selectedObjectsOf(document).map(change), coalesceKey);
}

/** Sets properties on the selected objects that have them (e.g. `stroke` only applies to shapes and paths). */
export function patchSelectedObjects(patch: Record<string, unknown>, coalesceKey?: string): void {
  updateSelectedObjects((object) => {
    const applicable = Object.fromEntries(Object.entries(patch).filter(([key]) => key in object));
    return Object.keys(applicable).length > 0 ? ({ ...object, ...applicable } as EditorObject) : object;
  }, coalesceKey);
}

export function selectObjects(documentId: string, ids: string[]): void {
  store().setSelectedObjects(documentId, ids);
}

export function deleteObjects(documentId: string, pageId: string, ids: ReadonlySet<string>): void {
  const document = getDocument(documentId);
  if (!document) return;
  const current = objectsOnPage(document, pageId);
  const next = current.filter((object) => !ids.has(object.id));
  if (next.length === current.length) return;
  commitPageObjects(document, pageId, next, {
    selectedObjects: document.selectedObjects.filter((id) => !ids.has(id)),
  });
}

export function deleteSelectedObjects(): void {
  const document = getActiveDocument();
  const page = document && currentPageOf(document);
  if (document && page) deleteObjects(document.id, page.id, new Set(document.selectedObjects));
}

export function nudgeSelectedObjects(dx: number, dy: number): void {
  updateSelectedObjects((object) => ({ ...object, x: object.x + dx, y: object.y + dy }), 'nudge');
}

export function selectAllObjects(): void {
  const document = getActiveDocument();
  const page = document && currentPageOf(document);
  if (document && page) selectObjects(document.id, selectableObjects(document, page.id).map((object) => object.id));
}

// --- Clipboard -----------------------------------------------------------------------------

export function copySelectedObjects(): boolean {
  const document = getActiveDocument();
  const selected = document ? selectedObjectsOf(document) : EMPTY;
  if (selected.length === 0) return false;
  useToolStore.getState().setClipboard(selected);
  return true;
}

export function cutSelectedObjects(): void {
  if (copySelectedObjects()) deleteSelectedObjects();
}

function insertCopies(document: DocumentModel, page: PageModel, originals: readonly EditorObject[]): void {
  const copies = cloneObjects(originals, PASTE_OFFSET, PASTE_OFFSET);
  const { objects, layers } = placeObjects(document, page.id, copies);
  commitPageObjects(document, page.id, objects, { layers, selectedObjects: copies.map((object) => object.id) });
}

/** Pastes the copied objects onto the current page. Returns false when there is nothing to paste. */
export function pasteObjects(): boolean {
  const document = getActiveDocument();
  const page = document && currentPageOf(document);
  const { clipboard, setClipboard } = useToolStore.getState();
  if (!document || !page || clipboard.length === 0) return false;
  insertCopies(document, page, clipboard);
  // Shift the clipboard too, so repeated pastes cascade instead of stacking exactly.
  setClipboard(clipboard.map((object) => ({ ...object, x: object.x + PASTE_OFFSET, y: object.y + PASTE_OFFSET })));
  return true;
}

export function duplicateSelectedObjects(): void {
  const document = getActiveDocument();
  const page = document && currentPageOf(document);
  if (!document || !page) return;
  const selected = selectedObjectsOf(document);
  if (selected.length > 0) insertCopies(document, page, selected);
}

// --- Arrange -------------------------------------------------------------------------------

function rearrange(transform: (objects: EditorObject[], ids: Set<string>, page: PageModel) => EditorObject[]): void {
  const document = getActiveDocument();
  const page = document && currentPageOf(document);
  if (!document || !page || document.selectedObjects.length === 0) return;
  const current = objectsOnPage(document, page.id);
  const next = transform(current, new Set(document.selectedObjects), page);
  if (next.some((object, index) => object !== current[index])) commitPageObjects(document, page.id, next);
}

export function restackSelectedObjects(move: StackMove): void {
  rearrange((objects, ids) => restack(objects, ids, move));
}

export function alignSelectedObjects(alignment: Alignment): void {
  rearrange((objects, ids, page) =>
    alignObjects(objects, ids, alignment, { x: 0, y: 0, width: page.box.width, height: page.box.height }),
  );
}

export function distributeSelectedObjects(axis: 'horizontal' | 'vertical'): void {
  rearrange((objects, ids) => distributeObjects(objects, ids, axis));
}

// --- Layers, groups, locking ------------------------------------------------------------------

/** Moves the selected objects to another layer of the current page. */
export function moveSelectedObjectsToLayer(layerId: string): void {
  rearrange((objects, ids) => moveObjectsToLayer(objects, ids, layerId));
}

/** Makes the selected objects one group: from now on they are selected and moved together. */
export function groupSelectedObjects(): void {
  const groupId = newId();
  rearrange((objects, ids) => (ids.size < 2 ? objects : groupObjects(objects, ids, groupId)));
}

export function ungroupSelectedObjects(): void {
  rearrange((objects, ids) => ungroupObjects(objects, ids));
}

/** Locks the selected objects. Locked objects leave the selection, since they can no longer be edited. */
export function lockSelectedObjects(): void {
  const document = getActiveDocument();
  const page = document && currentPageOf(document);
  if (!document || !page || document.selectedObjects.length === 0) return;
  const next = setObjectsLocked(objectsOnPage(document, page.id), new Set(document.selectedObjects), true);
  commitPageObjects(document, page.id, next, { selectedObjects: [] });
}

/** Locks or unlocks specific objects of a page (used by the layers panel). */
export function setObjectLock(documentId: string, pageId: string, ids: readonly string[], locked: boolean): void {
  const document = getDocument(documentId);
  if (!document) return;
  const current = objectsOnPage(document, pageId);
  const next = setObjectsLocked(current, new Set(ids), locked);
  if (next.every((object, index) => object === current[index])) return;
  commitPageObjects(document, pageId, next, {
    selectedObjects: locked ? document.selectedObjects.filter((id) => !ids.includes(id)) : document.selectedObjects,
  });
}

/** Unlocks every locked object of the current page. */
export function unlockAllObjects(): void {
  const document = getActiveDocument();
  const page = document && currentPageOf(document);
  if (!document || !page) return;
  const locked = objectsOnPage(document, page.id).filter((object) => object.locked).map((object) => object.id);
  setObjectLock(document.id, page.id, locked, false);
}

// --- Text ----------------------------------------------------------------------------------

/** Starts typing into a text object. Any text still being typed elsewhere is committed first. */
export function startTextEditing(documentId: string, pageId: string, object: TextObject): void {
  finishTextEditing();
  useToolStore.getState().setEditing({ documentId, pageId, objectId: object.id, text: object.text });
}

/**
 * Commits the text typed in the inline editor as one undoable step. An object
 * left empty is removed. Safe to call when nothing is being edited.
 */
export function finishTextEditing(): void {
  const { editing, setEditing } = useToolStore.getState();
  if (!editing) return;
  setEditing(null);
  const { documentId, pageId, objectId, text } = editing;
  const document = getDocument(documentId);
  const object = document && objectsOnPage(document, pageId).find((candidate) => candidate.id === objectId);
  if (!document || !object || object.type !== 'text') return;
  if (text.trim() === '') {
    deleteObjects(documentId, pageId, new Set([objectId]));
    return;
  }
  if (text !== object.text) replaceObjects(documentId, pageId, [{ ...object, text } satisfies TextObject]);
}

/** Switches the tool, committing any text that is still being typed. */
export function activateTool(tool: Tool): void {
  finishTextEditing();
  useToolStore.getState().setTool(tool);
}

// --- Images --------------------------------------------------------------------------------

interface ImageInput {
  name: string;
  data: Uint8Array;
}

/** Places images as objects on the current page. Reports the ones that cannot be decoded. */
export async function insertImages(images: readonly ImageInput[], problems: string[] = []): Promise<void> {
  const target = getActiveDocument();
  const targetPage = target && currentPageOf(target);
  if (!target || !targetPage) return;
  const ui = useUiStore.getState();

  ui.beginBusy();
  try {
    for (const image of images) {
      try {
        const decoded = await imageDecoder(image.name, image.data);
        const document = getDocument(target.id);
        const page = document?.pages.find((candidate) => candidate.id === targetPage.id);
        if (!document || !page) {
          decoded.bitmap.close?.();
          return;
        }
        const assetId = newId();
        registerImageAsset(assetId, decoded);
        store().addResources(document.id, [assetId]);
        const pixels = { width: decoded.bitmap.width, height: decoded.bitmap.height };
        // Objects live in unrotated page space, so the page's own box is the frame of reference.
        const frame = { width: page.box.width, height: page.box.height };
        addObject(document.id, page.id, createImageObject(assetId, pixels, frame));
      } catch (error) {
        console.error(error);
        problems.push(`${image.name}: ${i18n.t('errors.open.badImage')}`);
      }
    }
  } finally {
    ui.endBusy();
  }
  if (problems.length > 0) ui.showNotice({ titleKey: 'errors.openTitle', lines: problems });
  activateTool('select');
}

/** Lets the user pick image files and inserts them on the current page. */
export async function insertImageWithDialog(): Promise<void> {
  const results: OpenFileResult[] = await window.api.documents.openImagesDialog();
  const problems = results.flatMap((result) =>
    result.ok ? [] : [`${result.name}: ${i18n.t(`errors.open.${result.error}`)}`],
  );
  const images = results.flatMap((result) => (result.ok ? [{ name: result.file.name, data: result.file.data }] : []));
  if (images.length > 0 || problems.length > 0) await insertImages(images, problems);
}

/** Inserts image files that came from the clipboard or a drop (they have no path on disk). */
export async function insertImageFiles(files: readonly File[]): Promise<void> {
  const images: ImageInput[] = [];
  for (const file of files) images.push({ name: file.name || 'image.png', data: new Uint8Array(await file.arrayBuffer()) });
  if (images.length > 0) await insertImages(images);
}

/** Size of a page as displayed, for callers that only have the model. */
export function displayedPageSize(page: PageModel): { width: number; height: number } {
  return displaySize(pageGeometry(page));
}
