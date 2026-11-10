import {
  MIN_OBJECT_SIZE,
  TEXT_PADDING,
  type EditorObject,
  type ImageObject,
  type PathObject,
  type ShapeKind,
  type ShapeObject,
  type TextObject,
  type ToolStyle,
} from '@shared/types/objects';
import type { Point, Size } from '../coordinates/pageCoordinates';
import { boxFromPoints } from './geometry';
import { layoutText, measureText, type TextMeasurer } from './textLayout';

/** Creation and normalisation of editor objects. */

const newId = (): string => crypto.randomUUID();
/** New objects get their layer when they are added to a page (see `objectActions.addObject`). */
export const UNASSIGNED_LAYER = '';
const DEFAULT_TEXT_WIDTH = 220;
const DEFAULT_SHAPE = { width: 120, height: 80 };
/** A drag shorter than this (in points) counts as a click and creates a default-sized object. */
export const CLICK_TOLERANCE = 3;

/** Text boxes are as tall as their lines; call after anything that can change the layout. */
export function fitTextHeight(object: TextObject, measure?: TextMeasurer): TextObject {
  const { height } = layoutText(object, measure);
  return height === object.height ? object : { ...object, height };
}

/** Brings an object into a valid state after an edit. */
export function normaliseObject<T extends EditorObject>(object: T): T {
  if (object.type === 'text') {
    // Text replacing a line of the original stays on one line per paragraph: its box
    // grows with the text instead of wrapping onto whatever is below.
    if (object.replacesOriginal) {
      const widest = Math.max(...object.text.split('\n').map((line) => measureText(line, object)));
      const needed = widest + TEXT_PADDING * 2 + 1;
      if (needed > object.width) return fitTextHeight({ ...object, width: needed }) as T;
    }
    return fitTextHeight(object) as T;
  }
  const linear = object.type === 'shape' && (object.shape === 'line' || object.shape === 'arrow');
  // Lines may be perfectly horizontal or vertical; everything else needs a real area.
  const minimum = linear ? 0 : MIN_OBJECT_SIZE;
  const width = Math.max(minimum, object.width);
  const height = Math.max(minimum, object.height);
  return width === object.width && height === object.height ? object : { ...object, width, height };
}

export function createTextObject(at: Point, style: ToolStyle, text = ''): TextObject {
  return fitTextHeight({
    id: newId(),
    layerId: UNASSIGNED_LAYER,
    type: 'text',
    x: at.x,
    y: at.y,
    width: DEFAULT_TEXT_WIDTH,
    height: 0,
    rotation: 0,
    opacity: 1,
    text,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    bold: false,
    italic: false,
    color: style.textColor,
    align: 'left',
    lineHeight: 1.2,
    background: null,
    replacesOriginal: false,
  });
}

/** Creates a shape from a drag gesture; a mere click yields a default-sized shape centred on the point. */
export function createShapeObject(kind: ShapeKind, start: Point, end: Point, style: ToolStyle): ShapeObject {
  const clicked = Math.hypot(end.x - start.x, end.y - start.y) < CLICK_TOLERANCE;
  const box = clicked
    ? { x: start.x - DEFAULT_SHAPE.width / 2, y: start.y - DEFAULT_SHAPE.height / 2, ...DEFAULT_SHAPE }
    : boxFromPoints(start, end);
  const linear = kind === 'line' || kind === 'arrow';
  return normaliseObject({
    id: newId(),
    layerId: UNASSIGNED_LAYER,
    type: 'shape',
    shape: kind,
    ...box,
    rotation: 0,
    opacity: 1,
    stroke: style.stroke,
    strokeWidth: style.strokeWidth,
    fill: linear ? null : style.fill,
    dashed: false,
    // A line dragged up-right or down-left runs along the other diagonal of its box.
    flipped: linear && !clicked && (end.x - start.x) * (end.y - start.y) < 0,
  });
}

/** Creates a freehand stroke from page-space points, normalising them to the stroke's bounding box. */
export function createPathObject(points: readonly Point[], style: ToolStyle, highlighter: boolean): PathObject | null {
  const first = points[0];
  if (!first) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const width = Math.max(Math.max(...xs) - x, MIN_OBJECT_SIZE);
  const height = Math.max(Math.max(...ys) - y, MIN_OBJECT_SIZE);
  return {
    id: newId(),
    layerId: UNASSIGNED_LAYER,
    type: 'path',
    x,
    y,
    width,
    height,
    rotation: 0,
    opacity: highlighter ? 0.4 : 1,
    points: points.flatMap((point) => [(point.x - x) / width, (point.y - y) / height]),
    stroke: highlighter ? style.highlightColor : style.stroke,
    strokeWidth: highlighter ? Math.max(12, style.strokeWidth * 6) : style.strokeWidth,
    highlighter,
  };
}

/** Places an image on a page: at most 60 % of the page in either direction, centred. */
export function createImageObject(assetId: string, pixels: Size, page: Size): ImageObject {
  const scale = Math.min((page.width * 0.6) / pixels.width, (page.height * 0.6) / pixels.height, 1);
  const width = Math.max(MIN_OBJECT_SIZE, pixels.width * scale);
  const height = Math.max(MIN_OBJECT_SIZE, pixels.height * scale);
  return {
    id: newId(),
    layerId: UNASSIGNED_LAYER,
    type: 'image',
    assetId,
    x: (page.width - width) / 2,
    y: (page.height - height) / 2,
    width,
    height,
    rotation: 0,
    opacity: 1,
    flipX: false,
    flipY: false,
  };
}

/** Copies objects with fresh ids, shifted by the given offset. */
export function cloneObjects(objects: readonly EditorObject[], dx = 0, dy = 0): EditorObject[] {
  // Copies of grouped objects form new groups of their own.
  const groups = new Map<string, string>();
  return objects.map((object) => {
    let groupId = object.groupId;
    if (groupId) {
      if (!groups.has(groupId)) groups.set(groupId, newId());
      groupId = groups.get(groupId);
    }
    return { ...object, id: newId(), groupId, locked: false, x: object.x + dx, y: object.y + dy };
  });
}
