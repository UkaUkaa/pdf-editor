import type { EditorObject } from '@shared/types/objects';
import { boundsOf, translate, unionBounds, type Box } from './geometry';

/** Stacking order and alignment. All functions return new arrays and leave untouched objects identical. */

export type StackMove = 'front' | 'forward' | 'backward' | 'back';
export type Alignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/** Changes the stacking order of the selected objects, keeping their relative order. */
export function restack(objects: readonly EditorObject[], ids: ReadonlySet<string>, move: StackMove): EditorObject[] {
  const selected = objects.filter((object) => ids.has(object.id));
  const others = objects.filter((object) => !ids.has(object.id));
  if (selected.length === 0) return [...objects];
  if (move === 'front') return [...others, ...selected];
  if (move === 'back') return [...selected, ...others];

  const result = [...objects];
  if (move === 'forward') {
    // Walk from the top so that neighbouring selected objects do not leapfrog each other.
    for (let index = result.length - 2; index >= 0; index -= 1) {
      const current = result[index]!;
      const above = result[index + 1]!;
      if (ids.has(current.id) && !ids.has(above.id)) [result[index], result[index + 1]] = [above, current];
    }
  } else {
    for (let index = 1; index < result.length; index += 1) {
      const current = result[index]!;
      const below = result[index - 1]!;
      if (ids.has(current.id) && !ids.has(below.id)) [result[index], result[index - 1]] = [below, current];
    }
  }
  return result;
}

/**
 * Aligns the selected objects to their common bounds, or to `page` when only
 * one object is selected.
 */
export function alignObjects(
  objects: readonly EditorObject[],
  ids: ReadonlySet<string>,
  alignment: Alignment,
  page: Box,
): EditorObject[] {
  const selected = objects.filter((object) => ids.has(object.id));
  const frame = selected.length > 1 ? unionBounds(selected) : page;
  if (!frame || selected.length === 0) return [...objects];

  return objects.map((object) => {
    if (!ids.has(object.id)) return object;
    const bounds = boundsOf(object);
    let dx = 0;
    let dy = 0;
    if (alignment === 'left') dx = frame.x - bounds.x;
    else if (alignment === 'center') dx = frame.x + frame.width / 2 - (bounds.x + bounds.width / 2);
    else if (alignment === 'right') dx = frame.x + frame.width - (bounds.x + bounds.width);
    else if (alignment === 'top') dy = frame.y - bounds.y;
    else if (alignment === 'middle') dy = frame.y + frame.height / 2 - (bounds.y + bounds.height / 2);
    else dy = frame.y + frame.height - (bounds.y + bounds.height);
    return dx === 0 && dy === 0 ? object : translate(object, dx, dy);
  });
}

/** Spaces three or more selected objects so that the gaps between them are equal. */
export function distributeObjects(
  objects: readonly EditorObject[],
  ids: ReadonlySet<string>,
  axis: 'horizontal' | 'vertical',
): EditorObject[] {
  const horizontal = axis === 'horizontal';
  const selected = objects
    .filter((object) => ids.has(object.id))
    .map((object) => ({ object, bounds: boundsOf(object) }))
    .sort((a, b) => (horizontal ? a.bounds.x - b.bounds.x : a.bounds.y - b.bounds.y));
  if (selected.length < 3) return [...objects];

  const start = (bounds: Box): number => (horizontal ? bounds.x : bounds.y);
  const size = (bounds: Box): number => (horizontal ? bounds.width : bounds.height);
  const first = selected[0]!;
  const last = selected.at(-1)!;
  const total = start(last.bounds) + size(last.bounds) - start(first.bounds);
  const occupied = selected.reduce((sum, item) => sum + size(item.bounds), 0);
  const gap = (total - occupied) / (selected.length - 1);

  const moved = new Map<string, EditorObject>();
  let cursor = start(first.bounds);
  for (const { object, bounds } of selected) {
    const delta = cursor - start(bounds);
    if (Math.abs(delta) > 1e-9) moved.set(object.id, horizontal ? translate(object, delta, 0) : translate(object, 0, delta));
    cursor += size(bounds) + gap;
  }
  return objects.map((object) => moved.get(object.id) ?? object);
}
