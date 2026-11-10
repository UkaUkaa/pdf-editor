import type { DocumentModel } from '@shared/types/document';
import { displaySize, pageGeometry } from '../../engine/coordinates/pageCoordinates';
import {
  createBlankPage,
  deletePages,
  duplicatePages,
  insertPages,
  movePages,
  reversePages,
  rotatePages,
  samePages,
  shiftPages,
} from '../../engine/document/pageOperations';
import { cloneObjects } from '../../engine/objects/factory';
import { i18n } from '../../localization/i18n';
import { getActiveDocument, getDocument, useDocumentsStore } from '../../stores/documentsStore';
import { useUiStore } from '../../stores/uiStore';
import { targetPageIds } from '../documents/documentActions';

const newId = (): string => crypto.randomUUID();
const store = () => useDocumentsStore.getState();

/** Adds a blank page after the selection, sized like the current page. */
export function addBlankPage(): void {
  const document = getActiveDocument();
  if (!document) return;
  const targets = targetPageIds(document);
  const last = document.pages.findLastIndex((page) => targets.has(page.id));
  const reference = document.pages[last === -1 ? document.pages.length - 1 : last];
  const page = createBlankPage(newId, reference ? displaySize(pageGeometry(reference)) : undefined);
  store().commit(document.id, {
    pages: insertPages(document.pages, last + 1 || document.pages.length, [page]),
    selection: [page.id],
  });
}

/** Deletes the selected pages after confirmation. A document always keeps at least one page. */
export async function deleteSelectedPages(): Promise<boolean> {
  const document = getActiveDocument();
  if (!document) return false;
  const targets = targetPageIds(document);
  if (targets.size === 0 || targets.size >= document.pages.length) return false;

  const answer = await useUiStore.getState().confirm({
    title: i18n.t('dialogs.deletePages.title'),
    message: i18n.t('dialogs.deletePages.message', { count: targets.size }),
    confirmLabel: i18n.t('dialogs.deletePages.confirm'),
    danger: true,
  });
  if (answer !== 'confirm') return false;

  // Re-read: the document may have changed while the dialog was open.
  const current = getDocument(document.id);
  if (!current) return false;
  const pages = deletePages(current.pages, targets);
  if (pages.length === 0 || pages.length === current.pages.length) return false;
  // Objects on deleted pages go with them (undo restores both).
  const without = <T>(map: Record<string, T>): Record<string, T> => {
    const kept = Object.fromEntries(Object.entries(map).filter(([pageId]) => !targets.has(pageId)));
    return Object.keys(kept).length === Object.keys(map).length ? map : kept;
  };
  store().commit(current.id, { pages, objects: without(current.objects), layers: without(current.layers), selection: [] });
  return true;
}

export function canDeleteSelectedPages(document: DocumentModel): boolean {
  const count = targetPageIds(document).size;
  return count > 0 && count < document.pages.length;
}

export function duplicateSelectedPages(): void {
  const document = getActiveDocument();
  if (!document) return;
  const { pages, copies } = duplicatePages(document.pages, targetPageIds(document), newId);
  if (copies.length === 0) return;
  // A copied page gets its own copies of the layers and objects of the original.
  const originals = document.pages.filter((page) => targetPageIds(document).has(page.id));
  let objects = document.objects;
  let layers = document.layers;
  copies.forEach((copy, index) => {
    const originalId = originals[index]?.id ?? '';
    const sourceLayers = document.layers[originalId];
    const layerIds = new Map((sourceLayers ?? []).map((layer) => [layer.id, newId()]));
    if (sourceLayers?.length) {
      layers = { ...layers, [copy.id]: sourceLayers.map((layer) => ({ ...layer, id: layerIds.get(layer.id)! })) };
    }
    const sourceObjects = document.objects[originalId];
    if (sourceObjects?.length) {
      const copied = cloneObjects(sourceObjects).map((object, position) => ({
        ...object,
        locked: sourceObjects[position]!.locked,
        layerId: layerIds.get(object.layerId) ?? object.layerId,
      }));
      objects = { ...objects, [copy.id]: copied };
    }
  });
  store().commit(document.id, { pages, objects, layers, selection: copies.map((page) => page.id) });
}

export function rotateSelectedPages(delta: 90 | -90 | 180): void {
  const document = getActiveDocument();
  if (document) store().commit(document.id, { pages: rotatePages(document.pages, targetPageIds(document), delta) });
}

/** Moves pages to gap `targetIndex` (see `movePages`); a move that changes nothing is not recorded. */
export function movePagesTo(documentId: string, ids: readonly string[], targetIndex: number): void {
  const document = getDocument(documentId);
  if (!document) return;
  const pages = movePages(document.pages, new Set(ids), targetIndex);
  if (!samePages(pages, document.pages)) store().commit(document.id, { pages, selection: [...ids] });
}

export function shiftSelectedPages(direction: 1 | -1): void {
  const document = getActiveDocument();
  if (!document) return;
  const targets = targetPageIds(document);
  const pages = shiftPages(document.pages, targets, direction);
  if (!samePages(pages, document.pages)) store().commit(document.id, { pages, selection: [...targets] });
}

export function canShiftSelectedPages(document: DocumentModel, direction: 1 | -1): boolean {
  return !samePages(shiftPages(document.pages, targetPageIds(document), direction), document.pages);
}

export function reverseAllPages(): void {
  const document = getActiveDocument();
  if (document && document.pages.length > 1) store().commit(document.id, { pages: reversePages(document.pages) });
}

export function undo(): void {
  const document = getActiveDocument();
  if (document) store().undo(document.id);
}

export function redo(): void {
  const document = getActiveDocument();
  if (document) store().redo(document.id);
}

// --- Selection -----------------------------------------------------------------------------

export type SelectionMode = 'single' | 'toggle' | 'range';

/** Applies a click on a thumbnail to the selection, like a file manager would. */
export function selectPage(documentId: string, pageId: string, mode: SelectionMode): void {
  const document = getDocument(documentId);
  if (!document) return;
  const index = document.pages.findIndex((page) => page.id === pageId);
  if (index === -1) return;

  let selection: string[];
  if (mode === 'toggle') {
    selection = document.selection.includes(pageId)
      ? document.selection.filter((id) => id !== pageId)
      : [...document.selection, pageId];
  } else if (mode === 'range') {
    // The range extends from the page that was current before the click.
    const anchor = Math.min(document.view.currentPage, document.pages.length - 1);
    const [from, to] = anchor <= index ? [anchor, index] : [index, anchor];
    selection = document.pages.slice(from, to + 1).map((page) => page.id);
  } else {
    selection = [pageId];
  }
  store().setSelection(documentId, selection);
}

export function selectAllPages(documentId: string): void {
  const document = getDocument(documentId);
  if (document) store().setSelection(documentId, document.pages.map((page) => page.id));
}

export function clearSelection(documentId: string): void {
  store().setSelection(documentId, []);
}
