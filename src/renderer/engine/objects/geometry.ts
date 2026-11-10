import type { PageRotation } from '@shared/types/document';
import { MIN_OBJECT_SIZE, type EditorObject } from '@shared/types/objects';
import type { Point, Size } from '../coordinates/pageCoordinates';

/** Pure geometry for editable objects, all in page space (points, y down). */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Geometry = Pick<EditorObject, 'x' | 'y' | 'width' | 'height' | 'rotation'>;

/** The eight resize handles, named by compass direction in the object's own (unrotated) frame. */
export const RESIZE_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export type ResizeHandle = (typeof RESIZE_HANDLES)[number];

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

export function rotatePoint(point: Point, centre: Point, degrees: number): Point {
  const angle = toRadians(degrees);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point.x - centre.x;
  const dy = point.y - centre.y;
  // y points down, so a positive angle is a clockwise turn on screen.
  return { x: centre.x + dx * cos - dy * sin, y: centre.y + dx * sin + dy * cos };
}

export const centreOf = (box: Box): Point => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

/** Corners of the rotated object: top-left, top-right, bottom-right, bottom-left. */
export function cornersOf(object: Geometry): Point[] {
  const centre = centreOf(object);
  return [
    { x: object.x, y: object.y },
    { x: object.x + object.width, y: object.y },
    { x: object.x + object.width, y: object.y + object.height },
    { x: object.x, y: object.y + object.height },
  ].map((corner) => rotatePoint(corner, centre, object.rotation));
}

/** Axis-aligned bounding box of the rotated object. */
export function boundsOf(object: Geometry): Box {
  const corners = cornersOf(object);
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function unionBounds(objects: readonly Geometry[]): Box | null {
  if (objects.length === 0) return null;
  const boxes = objects.map(boundsOf);
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((box) => box.x + box.width)) - x,
    height: Math.max(...boxes.map((box) => box.y + box.height)) - y,
  };
}

export function boxesIntersect(a: Box, b: Box): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

export function boxFromPoints(a: Point, b: Point): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

/** Position of a resize handle on the rotated object. */
export function handlePosition(object: Geometry, handle: ResizeHandle): Point {
  const fx = handle.includes('w') ? 0 : handle.includes('e') ? 1 : 0.5;
  const fy = handle.includes('n') ? 0 : handle.includes('s') ? 1 : 0.5;
  return rotatePoint(
    { x: object.x + object.width * fx, y: object.y + object.height * fy },
    centreOf(object),
    object.rotation,
  );
}

export interface ResizeOptions {
  /** Keep the width/height ratio (Shift, or objects that must not be distorted). */
  keepAspect?: boolean;
  minWidth?: number;
  minHeight?: number;
}

/**
 * Resizes an object by dragging one handle to `pointer`. The opposite handle
 * stays exactly where it is, also for rotated objects.
 */
export function resizeObject<T extends Geometry>(
  object: T,
  handle: ResizeHandle,
  pointer: Point,
  { keepAspect = false, minWidth = MIN_OBJECT_SIZE, minHeight = MIN_OBJECT_SIZE }: ResizeOptions = {},
): T {
  const centre = centreOf(object);
  // Work in the object's own frame, where the box is axis-aligned.
  const local = rotatePoint(pointer, centre, -object.rotation);
  const movesX = handle.includes('w') || handle.includes('e');
  const movesY = handle.includes('n') || handle.includes('s');

  let left = object.x;
  let right = object.x + object.width;
  let top = object.y;
  let bottom = object.y + object.height;
  if (handle.includes('w')) left = Math.min(local.x, right - minWidth);
  if (handle.includes('e')) right = Math.max(local.x, left + minWidth);
  if (handle.includes('n')) top = Math.min(local.y, bottom - minHeight);
  if (handle.includes('s')) bottom = Math.max(local.y, top + minHeight);

  if (keepAspect && object.width > 0 && object.height > 0) {
    const ratio = object.width / object.height;
    let width = right - left;
    let height = bottom - top;
    if (movesX && movesY) {
      // Corner: follow the larger relative change.
      if (width / object.width > height / object.height) height = width / ratio;
      else width = height * ratio;
    } else if (movesX) {
      height = width / ratio;
    } else {
      width = height * ratio;
    }
    if (handle.includes('w')) left = right - width;
    else if (handle.includes('e')) right = left + width;
    else {
      const middle = (left + right) / 2;
      left = middle - width / 2;
      right = middle + width / 2;
    }
    if (handle.includes('n')) top = bottom - height;
    else if (handle.includes('s')) bottom = top + height;
    else {
      const middle = (top + bottom) / 2;
      top = middle - height / 2;
      bottom = middle + height / 2;
    }
  }

  // The new box was computed around the old centre. Rotating about its own (new) centre
  // would move the fixed corner, so shift the box until the old and new frames agree.
  const width = right - left;
  const height = bottom - top;
  const newCentreLocal = { x: left + width / 2, y: top + height / 2 };
  const newCentre = rotatePoint(newCentreLocal, centre, object.rotation);
  return { ...object, x: newCentre.x - width / 2, y: newCentre.y - height / 2, width, height };
}

/** Rotation (degrees) that points the object's top edge towards `pointer`; snaps to 15° steps on request. */
export function rotationTowards(object: Geometry, pointer: Point, snap: boolean): number {
  const centre = centreOf(object);
  const degrees = (Math.atan2(pointer.y - centre.y, pointer.x - centre.x) * 180) / Math.PI + 90;
  const normalised = ((degrees % 360) + 360) % 360;
  const snapped = snap ? Math.round(normalised / 15) * 15 : Math.round(normalised * 10) / 10;
  return snapped % 360;
}

export function translate<T extends Geometry>(object: T, dx: number, dy: number): T {
  return { ...object, x: object.x + dx, y: object.y + dy };
}

/** Whether `point` lies inside the rotated box, grown by `tolerance` on each side. */
export function containsPoint(object: Geometry, point: Point, tolerance = 0): boolean {
  const local = rotatePoint(point, centreOf(object), -object.rotation);
  return (
    local.x >= object.x - tolerance &&
    local.x <= object.x + object.width + tolerance &&
    local.y >= object.y - tolerance &&
    local.y <= object.y + object.height + tolerance
  );
}

// --- Page space <-> displayed page -------------------------------------------------------------

/** Maps a page-space point to the page as displayed (after page rotation), in points. */
export function pageToDisplay(point: Point, page: Size, rotation: PageRotation): Point {
  switch (rotation) {
    case 0:
      return point;
    case 90:
      return { x: page.height - point.y, y: point.x };
    case 180:
      return { x: page.width - point.x, y: page.height - point.y };
    case 270:
      return { x: point.y, y: page.width - point.x };
  }
}

export function displayToPage(point: Point, page: Size, rotation: PageRotation): Point {
  switch (rotation) {
    case 0:
      return point;
    case 90:
      return { x: point.y, y: page.height - point.x };
    case 180:
      return { x: page.width - point.x, y: page.height - point.y };
    case 270:
      return { x: page.width - point.y, y: point.x };
  }
}

/** SVG transform that draws page-space content on the displayed (rotated) page. */
export function pageRotationTransform(page: Size, rotation: PageRotation): string | undefined {
  switch (rotation) {
    case 0:
      return undefined;
    case 90:
      return `translate(${page.height} 0) rotate(90)`;
    case 180:
      return `translate(${page.width} ${page.height}) rotate(180)`;
    case 270:
      return `translate(0 ${page.width}) rotate(270)`;
  }
}
