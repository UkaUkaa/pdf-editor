import type { Layer, LayerType } from '@shared/types/layers';
import type { EditorObject, ObjectType } from '@shared/types/objects';

/** Pure operations on the layer stack of one page (bottom to top) and the objects on it. */

export type IdFactory = () => string;

/** Layer type that new objects of a given kind go to when the user has not chosen a layer. */
export const DEFAULT_LAYER_TYPE: Record<ObjectType, LayerType> = {
  text: 'text',
  image: 'image',
  shape: 'shapes',
  path: 'drawing',
  note: 'annotation',
  link: 'annotation',
};

export function createLayer(id: string, name: string, type: LayerType = 'custom'): Layer {
  return { id, name, type, visible: true, locked: false, opacity: 1 };
}

/** Whether new objects may be put on the layer. */
export const isLayerUsable = (layer: Layer | undefined): layer is Layer =>
  layer !== undefined && layer.visible && !layer.locked;

export interface LayerTarget {
  layers: Layer[];
  layerId: string;
}

/**
 * Decides which layer new objects of `type` go to: the layer the user is
 * working on if it can take them, otherwise the page's layer of the matching
 * type, which is created on top of the stack when it does not exist yet.
 */
export function resolveTargetLayer(
  layers: readonly Layer[],
  activeId: string | undefined,
  type: LayerType,
  makeId: IdFactory,
  name: string,
): LayerTarget {
  const active = layers.find((layer) => layer.id === activeId);
  if (isLayerUsable(active)) return { layers: layers as Layer[], layerId: active.id };
  const typed = layers.findLast((layer) => layer.type === type && isLayerUsable(layer));
  if (typed) return { layers: layers as Layer[], layerId: typed.id };
  const created = createLayer(makeId(), uniqueLayerName(layers, name), type);
  return { layers: [...layers, created], layerId: created.id };
}

/** `name`, or `name 2`, `name 3`, … when it is taken. */
export function uniqueLayerName(layers: readonly Layer[], name: string): string {
  const taken = new Set(layers.map((layer) => layer.name));
  if (!taken.has(name)) return name;
  for (let number = 2; ; number += 1) {
    if (!taken.has(`${name} ${number}`)) return `${name} ${number}`;
  }
}

/** Inserts a layer directly above `aboveId`, or on top when that layer does not exist. */
export function insertLayer(layers: readonly Layer[], layer: Layer, aboveId?: string): Layer[] {
  const index = layers.findIndex((candidate) => candidate.id === aboveId);
  const at = index === -1 ? layers.length : index + 1;
  return [...layers.slice(0, at), layer, ...layers.slice(at)];
}

export function updateLayer(layers: readonly Layer[], id: string, patch: Partial<Omit<Layer, 'id'>>): Layer[] {
  return layers.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer));
}

/** Moves a layer one step up (+1, towards the top) or down (-1). */
export function shiftLayer(layers: readonly Layer[], id: string, direction: 1 | -1): Layer[] {
  const index = layers.findIndex((layer) => layer.id === id);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= layers.length) return layers as Layer[];
  const result = [...layers];
  [result[index], result[target]] = [result[target]!, result[index]!];
  return result;
}

/** Moves a layer to position `index` of the resulting stack (0 = bottom). */
export function moveLayer(layers: readonly Layer[], id: string, index: number): Layer[] {
  const layer = layers.find((candidate) => candidate.id === id);
  if (!layer) return layers as Layer[];
  const others = layers.filter((candidate) => candidate.id !== id);
  const at = Math.min(Math.max(Math.trunc(index), 0), others.length);
  const result = [...others.slice(0, at), layer, ...others.slice(at)];
  return result.every((candidate, position) => candidate === layers[position]) ? (layers as Layer[]) : result;
}

export interface LayerChange {
  layers: Layer[];
  objects: EditorObject[];
}

/** Removes a layer together with the objects on it. */
export function removeLayer(layers: readonly Layer[], objects: readonly EditorObject[], id: string): LayerChange {
  return {
    layers: layers.filter((layer) => layer.id !== id),
    objects: objects.filter((object) => object.layerId !== id),
  };
}

/** Copies a layer and its objects; the copy is placed directly above the original. */
export function duplicateLayer(
  layers: readonly Layer[],
  objects: readonly EditorObject[],
  id: string,
  makeId: IdFactory,
  name: string,
): LayerChange & { copyId: string | null } {
  const original = layers.find((layer) => layer.id === id);
  if (!original) return { layers: layers as Layer[], objects: objects as EditorObject[], copyId: null };
  const copy: Layer = { ...original, id: makeId(), name: uniqueLayerName(layers, name) };
  const groups = new Map<string, string>();
  const copies = objects
    .filter((object) => object.layerId === id)
    .map((object) => {
      // Groups are copied as new groups, so the copy does not join the original's group.
      let groupId = object.groupId;
      if (groupId) {
        if (!groups.has(groupId)) groups.set(groupId, makeId());
        groupId = groups.get(groupId);
      }
      return { ...object, id: makeId(), layerId: copy.id, groupId };
    });
  return { layers: insertLayer(layers, copy, id), objects: [...objects, ...copies], copyId: copy.id };
}

/**
 * Merges a layer into the one below it: its objects move down (keeping their
 * place above the lower layer's own objects) and the layer disappears.
 */
export function mergeLayerDown(layers: readonly Layer[], objects: readonly EditorObject[], id: string): LayerChange | null {
  const index = layers.findIndex((layer) => layer.id === id);
  const below = layers[index - 1];
  if (index <= 0 || !below) return null;
  const staying = objects.filter((object) => object.layerId !== id);
  const moving = objects.filter((object) => object.layerId === id).map((object) => ({ ...object, layerId: below.id }));
  return { layers: layers.filter((layer) => layer.id !== id), objects: [...staying, ...moving] };
}

/** Puts objects on another layer, on top of what is already there. */
export function moveObjectsToLayer(objects: readonly EditorObject[], ids: ReadonlySet<string>, layerId: string): EditorObject[] {
  const moving = objects.filter((object) => ids.has(object.id) && object.layerId !== layerId);
  if (moving.length === 0) return objects as EditorObject[];
  const moved = new Set(moving.map((object) => object.id));
  return [...objects.filter((object) => !moved.has(object.id)), ...moving.map((object) => ({ ...object, layerId }))];
}

export interface ResolvedObject {
  /** The object as it should be painted: its opacity already includes the layer's. */
  object: EditorObject;
  layer: Layer;
  /** Whether the object can be selected and changed on the canvas. */
  interactive: boolean;
}

/**
 * Objects in painting order (bottom layer first, then stacking order within
 * the layer), without those on hidden layers. Used identically by the canvas,
 * thumbnails and the PDF export, so all three always agree.
 */
export function resolveObjects(layers: readonly Layer[], objects: readonly EditorObject[]): ResolvedObject[] {
  const resolved: ResolvedObject[] = [];
  for (const layer of layers) {
    if (!layer.visible) continue;
    for (const object of objects) {
      if (object.layerId !== layer.id) continue;
      resolved.push({
        object: layer.opacity === 1 ? object : { ...object, opacity: object.opacity * layer.opacity },
        layer,
        interactive: !layer.locked && !object.locked,
      });
    }
  }
  return resolved;
}

export function countObjects(objects: readonly EditorObject[], layerId: string): number {
  return objects.reduce((count, object) => count + (object.layerId === layerId ? 1 : 0), 0);
}

// --- Groups --------------------------------------------------------------------------------

/** Extends a set of object ids to whole groups: touching one member selects all of them. */
export function expandToGroups(objects: readonly EditorObject[], ids: readonly string[]): string[] {
  const wanted = new Set(ids);
  const groups = new Set(objects.flatMap((object) => (wanted.has(object.id) && object.groupId ? [object.groupId] : [])));
  if (groups.size === 0) return [...ids];
  const result = [...ids];
  for (const object of objects) {
    if (object.groupId && groups.has(object.groupId) && !wanted.has(object.id)) result.push(object.id);
  }
  return result;
}

export function groupObjects(objects: readonly EditorObject[], ids: ReadonlySet<string>, groupId: string): EditorObject[] {
  return objects.map((object) => (ids.has(object.id) ? { ...object, groupId } : object));
}

export function ungroupObjects(objects: readonly EditorObject[], ids: ReadonlySet<string>): EditorObject[] {
  return objects.map((object) => {
    if (!ids.has(object.id) || !object.groupId) return object;
    const rest = { ...object };
    delete rest.groupId;
    return rest;
  });
}

export function setObjectsLocked(objects: readonly EditorObject[], ids: ReadonlySet<string>, locked: boolean): EditorObject[] {
  return objects.map((object) => (ids.has(object.id) && Boolean(object.locked) !== locked ? { ...object, locked } : object));
}
