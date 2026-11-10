import type { DocumentModel } from '@shared/types/document';
import type { Layer } from '@shared/types/layers';
import type { EditorObject } from '@shared/types/objects';
import {
  countObjects,
  createLayer,
  duplicateLayer,
  insertLayer,
  mergeLayerDown,
  moveLayer,
  removeLayer,
  shiftLayer,
  uniqueLayerName,
  updateLayer,
} from '../../engine/layers/layerOperations';
import { i18n } from '../../localization/i18n';
import { getActiveDocument, getDocument, useDocumentsStore } from '../../stores/documentsStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUiStore } from '../../stores/uiStore';
import { currentPageOf, layersOnPage, objectsOnPage } from '../pdf-editor/objectActions';

const newId = (): string => crypto.randomUUID();
const store = () => useDocumentsStore.getState();

export interface LayerContext {
  document: DocumentModel;
  pageId: string;
  layers: Layer[];
  objects: EditorObject[];
  /** The layer the user is working on; defaults to the top-most one. */
  active: Layer | undefined;
}

/** Layers of the current page of a document, with the active layer resolved. */
export function layerContext(document: DocumentModel | null = getActiveDocument()): LayerContext | null {
  const page = document && currentPageOf(document);
  if (!document || !page) return null;
  const layers = layersOnPage(document, page.id);
  const active = layers.find((layer) => layer.id === document.activeLayers[page.id]) ?? layers.at(-1);
  return { document, pageId: page.id, layers, objects: objectsOnPage(document, page.id), active };
}

function commit(
  context: LayerContext,
  layers: Layer[],
  objects: EditorObject[] = context.objects,
  options: { activeId?: string; coalesceKey?: string } = {},
): void {
  const { document, pageId } = context;
  if (layers === context.layers && objects === context.objects) return;
  // Objects that are gone, hidden or locked cannot stay selected.
  const usable = new Set(layers.filter((layer) => layer.visible && !layer.locked).map((layer) => layer.id));
  const selectable = new Set(objects.filter((object) => usable.has(object.layerId) && !object.locked).map((object) => object.id));
  store().commit(document.id, {
    layers: layers === context.layers ? undefined : { ...document.layers, [pageId]: layers },
    objects: objects === context.objects ? undefined : { ...document.objects, [pageId]: objects },
    selectedObjects: document.selectedObjects.filter((id) => selectable.has(id)),
    coalesceKey: options.coalesceKey,
  });
  if (options.activeId) store().setActiveLayer(document.id, pageId, options.activeId);
}

export function setActiveLayer(layerId: string): void {
  const context = layerContext();
  if (context) store().setActiveLayer(context.document.id, context.pageId, layerId);
}

/** Adds an empty layer above the active one and makes it active. */
export function addLayer(): void {
  const context = layerContext();
  if (!context) return;
  const layer = createLayer(newId(), uniqueLayerName(context.layers, i18n.t('layers.newName')));
  commit(context, insertLayer(context.layers, layer, context.active?.id), context.objects, { activeId: layer.id });
}

/** Deletes a layer; asks first when objects would be deleted with it. */
export async function deleteLayer(layerId = layerContext()?.active?.id): Promise<boolean> {
  const before = layerContext();
  const layer = before?.layers.find((candidate) => candidate.id === layerId);
  if (!before || !layer) return false;
  const count = countObjects(before.objects, layer.id);
  if (count > 0) {
    const answer = await useUiStore.getState().confirm({
      title: i18n.t('layers.deleteTitle'),
      message: i18n.t('layers.deleteMessage', { name: layer.name, count }),
      confirmLabel: i18n.t('dialogs.deletePages.confirm'),
      danger: true,
    });
    if (answer !== 'confirm') return false;
  }
  // Re-read: the document may have changed while the dialog was open.
  const context = layerContext(getDocument(before.document.id));
  if (!context || context.pageId !== before.pageId || !context.layers.some((candidate) => candidate.id === layer.id)) return false;
  const index = context.layers.findIndex((candidate) => candidate.id === layer.id);
  const change = removeLayer(context.layers, context.objects, layer.id);
  const neighbour = change.layers[Math.min(index, change.layers.length - 1)];
  commit(context, change.layers, change.objects, { activeId: neighbour?.id });
  return true;
}

export function renameLayer(layerId: string, name: string): void {
  const context = layerContext();
  const trimmed = name.trim();
  const layer = context?.layers.find((candidate) => candidate.id === layerId);
  if (!context || !layer || trimmed === '' || trimmed === layer.name) return;
  commit(context, updateLayer(context.layers, layerId, { name: trimmed.slice(0, 80) }));
}

/** Opens the layers panel with the active layer's name ready to be typed over. */
export function startRenamingLayer(): void {
  const context = layerContext();
  if (!context?.active) return;
  useSettingsStore.getState().update({ layout: { leftCollapsed: false, leftTab: 'layers' } });
  useUiStore.getState().setRenamingLayer(context.active.id);
}

export function duplicateActiveLayer(): void {
  const context = layerContext();
  if (!context?.active) return;
  const name = `${context.active.name} ${i18n.t('documents.copySuffix')}`;
  const change = duplicateLayer(context.layers, context.objects, context.active.id, newId, name);
  if (change.copyId) commit(context, change.layers, change.objects, { activeId: change.copyId });
}

export function shiftActiveLayer(direction: 1 | -1): void {
  const context = layerContext();
  if (context?.active) commit(context, shiftLayer(context.layers, context.active.id, direction));
}

/** Moves a layer to a position in the stack (0 = bottom); used by drag and drop. */
export function moveLayerTo(layerId: string, index: number): void {
  const context = layerContext();
  if (context) commit(context, moveLayer(context.layers, layerId, index));
}

export function mergeActiveLayerDown(): void {
  const context = layerContext();
  if (!context?.active) return;
  const index = context.layers.findIndex((layer) => layer.id === context.active!.id);
  const change = mergeLayerDown(context.layers, context.objects, context.active.id);
  if (change) commit(context, change.layers, change.objects, { activeId: context.layers[index - 1]?.id });
}

export function setLayerProperties(layerId: string, patch: Partial<Pick<Layer, 'visible' | 'locked' | 'opacity'>>): void {
  const context = layerContext();
  const layer = context?.layers.find((candidate) => candidate.id === layerId);
  if (!context || !layer) return;
  const changed = (Object.keys(patch) as Array<keyof typeof patch>).some((key) => layer[key] !== patch[key]);
  if (!changed) return;
  commit(context, updateLayer(context.layers, layerId, patch), context.objects, {
    coalesceKey: patch.opacity !== undefined ? `layer-opacity:${layerId}` : undefined,
  });
}

export const canShiftActiveLayer = (context: LayerContext | null, direction: 1 | -1): boolean => {
  if (!context?.active) return false;
  const index = context.layers.indexOf(context.active);
  return direction === 1 ? index < context.layers.length - 1 : index > 0;
};
