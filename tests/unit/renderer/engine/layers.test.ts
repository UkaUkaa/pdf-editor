import { describe, expect, it } from 'vitest';
import type { Layer } from '@shared/types/layers';
import type { EditorObject } from '@shared/types/objects';
import {
  countObjects,
  createLayer,
  duplicateLayer,
  expandToGroups,
  groupObjects,
  insertLayer,
  mergeLayerDown,
  moveLayer,
  moveObjectsToLayer,
  removeLayer,
  resolveObjects,
  resolveTargetLayer,
  setObjectsLocked,
  shiftLayer,
  ungroupObjects,
  uniqueLayerName,
  updateLayer,
} from '@renderer/engine/layers/layerOperations';

const layer = (id: string, patch: Partial<Layer> = {}): Layer => ({ ...createLayer(id, id.toUpperCase()), ...patch });
const object = (id: string, layerId: string, patch: Partial<EditorObject> = {}): EditorObject =>
  ({ id, layerId, type: 'shape', shape: 'rect', x: 0, y: 0, width: 10, height: 10, rotation: 0, opacity: 1, stroke: '#000000', strokeWidth: 1, fill: null, dashed: false, flipped: false, ...patch }) as EditorObject;
const names = (layers: Layer[]): string => layers.map((item) => item.id).join('');
const ids = (objects: EditorObject[]): string => objects.map((item) => item.id).join('');
let counter = 0;
const makeId = (): string => `new${(counter += 1)}`;

describe('layer stack', () => {
  const stack = [layer('a'), layer('b'), layer('c')];

  it('inserts, moves and shifts layers without mutating the stack', () => {
    expect(names(insertLayer(stack, layer('x'), 'a'))).toBe('axbc');
    expect(names(insertLayer(stack, layer('x')))).toBe('abcx');
    expect(names(shiftLayer(stack, 'a', 1))).toBe('bac');
    expect(shiftLayer(stack, 'c', 1)).toBe(stack);
    expect(shiftLayer(stack, 'a', -1)).toBe(stack);
    expect(names(moveLayer(stack, 'a', 2))).toBe('bca');
    expect(names(moveLayer(stack, 'c', 0))).toBe('cab');
    expect(moveLayer(stack, 'b', 1)).toBe(stack);
    expect(names(stack)).toBe('abc');
    expect(updateLayer(stack, 'b', { visible: false })[1]).toMatchObject({ id: 'b', visible: false });
    expect(updateLayer(stack, 'b', { visible: false })[0]).toBe(stack[0]);
  });

  it('finds free names', () => {
    expect(uniqueLayerName(stack, 'Layer')).toBe('Layer');
    expect(uniqueLayerName([layer('x', { name: 'Layer' }), layer('y', { name: 'Layer 2' })], 'Layer')).toBe('Layer 3');
  });

  it('routes new objects to the active layer, else to the layer of their type, else to a new one', () => {
    const typed = [layer('t', { type: 'text' }), layer('s', { type: 'shapes' })];
    expect(resolveTargetLayer(typed, 's', 'text', makeId, 'Text')).toEqual({ layers: typed, layerId: 's' });
    expect(resolveTargetLayer(typed, undefined, 'text', makeId, 'Text').layerId).toBe('t');
    // A locked or hidden active layer cannot take objects: fall back to the typed layer.
    const lockedActive = [layer('t', { type: 'text' }), layer('s', { type: 'shapes', locked: true })];
    expect(resolveTargetLayer(lockedActive, 's', 'text', makeId, 'Text').layerId).toBe('t');
    // No usable layer of the type: one is created on top.
    const hidden = [layer('t', { type: 'text', visible: false, name: 'Text' })];
    const created = resolveTargetLayer(hidden, undefined, 'text', makeId, 'Text');
    expect(created.layers).toHaveLength(2);
    expect(created.layers[1]).toMatchObject({ id: created.layerId, type: 'text', name: 'Text 2', visible: true });
    expect(resolveTargetLayer([], undefined, 'drawing', makeId, 'Drawings').layers[0]).toMatchObject({ type: 'drawing', name: 'Drawings' });
  });

  it('removes, duplicates and merges layers together with their objects', () => {
    const objects = [object('1', 'a'), object('2', 'b', { groupId: 'g' }), object('3', 'b', { groupId: 'g' }), object('4', 'c')];
    const removed = removeLayer(stack, objects, 'b');
    expect(names(removed.layers)).toBe('ac');
    expect(ids(removed.objects)).toBe('14');

    const duplicated = duplicateLayer(stack, objects, 'b', makeId, 'B copy');
    expect(duplicated.layers.map((item) => item.name)).toEqual(['A', 'B', 'B copy', 'C']);
    const copies = duplicated.objects.filter((item) => item.layerId === duplicated.copyId);
    expect(copies).toHaveLength(2);
    // The copies form a group of their own.
    expect(copies[0]!.groupId).toBe(copies[1]!.groupId);
    expect(copies[0]!.groupId).not.toBe('g');
    expect(objects).toHaveLength(4);

    const merged = mergeLayerDown(stack, objects, 'b')!;
    expect(names(merged.layers)).toBe('ac');
    expect(merged.objects.map((item) => `${item.id}${item.layerId}`)).toEqual(['1a', '4c', '2a', '3a']);
    expect(mergeLayerDown(stack, objects, 'a')).toBeNull();
    expect(countObjects(merged.objects, 'a')).toBe(3);
  });

  it('paints bottom layer first, skips hidden layers and applies layer opacity and locks', () => {
    const layers = [layer('a', { opacity: 0.5 }), layer('b', { visible: false }), layer('c', { locked: true })];
    // Array order interleaves the layers on purpose.
    const objects = [object('c1', 'c'), object('a1', 'a', { opacity: 0.8 }), object('b1', 'b'), object('a2', 'a', { locked: true })];
    const resolved = resolveObjects(layers, objects);
    expect(resolved.map((entry) => entry.object.id)).toEqual(['a1', 'a2', 'c1']);
    expect(resolved[0]!.object.opacity).toBeCloseTo(0.4);
    expect(resolved.map((entry) => entry.interactive)).toEqual([true, false, false]);
    // Untouched objects keep their identity (cheap re-rendering).
    expect(resolved[2]!.object).toBe(objects[0]);
  });

  it('moves objects between layers on top of what is there', () => {
    const objects = [object('1', 'a'), object('2', 'b'), object('3', 'a')];
    const moved = moveObjectsToLayer(objects, new Set(['1']), 'b');
    expect(moved.map((item) => `${item.id}${item.layerId}`)).toEqual(['2b', '3a', '1b']);
    expect(moveObjectsToLayer(objects, new Set(['2']), 'b')).toBe(objects);
  });
});

describe('groups and locks', () => {
  const objects = [object('1', 'a'), object('2', 'a'), object('3', 'a'), object('4', 'a')];

  it('groups, expands selections to whole groups and ungroups', () => {
    const grouped = groupObjects(objects, new Set(['1', '3']), 'g1');
    expect(grouped.map((item) => item.groupId)).toEqual(['g1', undefined, 'g1', undefined]);
    expect(expandToGroups(grouped, ['3'])).toEqual(['3', '1']);
    expect(expandToGroups(grouped, ['2'])).toEqual(['2']);
    expect(expandToGroups(grouped, ['2', '1'])).toEqual(['2', '1', '3']);
    const ungrouped = ungroupObjects(grouped, new Set(['1']));
    expect('groupId' in ungrouped[0]!).toBe(false);
    expect(ungrouped[2]!.groupId).toBe('g1');
    expect(ungrouped[1]).toBe(grouped[1]);
  });

  it('locks and unlocks only what changes', () => {
    const locked = setObjectsLocked(objects, new Set(['2']), true);
    expect(locked.map((item) => Boolean(item.locked))).toEqual([false, true, false, false]);
    expect(locked[0]).toBe(objects[0]);
    expect(setObjectsLocked(locked, new Set(['1']), false)[0]).toBe(locked[0]);
    expect(setObjectsLocked(locked, new Set(['2']), false)[1]!.locked).toBe(false);
  });
});
