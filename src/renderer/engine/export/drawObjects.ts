import {
  appendBezierCurve,
  closePath,
  concatTransformationMatrix,
  fill,
  fillAndStroke,
  LineCapStyle,
  LineJoinStyle,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  setDashPattern,
  setFillingColor,
  setGraphicsState,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingColor,
  stroke,
  type PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFOperator,
  type PDFPage,
  type RGB,
} from '@cantoo/pdf-lib';
import { fontKey } from '@shared/fonts';
import type { PdfBox } from '@shared/types/document';
import type { EditorObject, PathObject, ShapeObject, TextObject } from '@shared/types/objects';

/** One laid-out line of a text object (see `layoutText`), in object-local points. */
export interface ExportTextLine {
  text: string;
  x: number;
  baseline: number;
}

export interface DrawResources {
  /** Resolves an embedded font by its key (see `fontKey`). */
  font: (fileName: string) => Promise<PDFFont>;
  image: (assetId: string) => Promise<PDFImage>;
  /** Line layout of every text object, keyed by object id. */
  textLines: Record<string, ExportTextLine[]>;
}

/** Control-point offset that makes four cubic Béziers approximate a circle. */
const KAPPA = 0.5522847498;

export function parseColor(hex: string): RGB {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return rgb(0, 0, 0);
  return rgb(parseInt(match[1]!, 16) / 255, parseInt(match[2]!, 16) / 255, parseInt(match[3]!, 16) / 255);
}

/**
 * Matrix mapping object-local coordinates (origin at the object's top-left
 * corner, y down, before rotation) to PDF user space of the page.
 */
export function localToPdfMatrix(object: EditorObject, box: PdfBox): [number, number, number, number, number, number] {
  const angle = (object.rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const halfWidth = object.width / 2;
  const halfHeight = object.height / 2;
  const centreX = object.x + halfWidth;
  const centreY = object.y + halfHeight;
  const top = box.y + box.height;
  return [
    cos,
    -sin,
    -sin,
    -cos,
    box.x + centreX - cos * halfWidth + sin * halfHeight,
    top - centreY + sin * halfWidth + cos * halfHeight,
  ];
}

function opacityState(document: PDFDocument, page: PDFPage, opacity: number, multiply = false): PDFOperator[] {
  if (opacity >= 1 && !multiply) return [];
  const state = document.context.obj({
    Type: 'ExtGState',
    CA: opacity,
    ca: opacity,
    ...(multiply ? { BM: 'Multiply' } : {}),
  });
  return [setGraphicsState(page.node.newExtGState('GS', state))];
}

function ellipsePath(width: number, height: number): PDFOperator[] {
  const rx = width / 2;
  const ry = height / 2;
  const ox = rx * KAPPA;
  const oy = ry * KAPPA;
  return [
    moveTo(rx, 0),
    appendBezierCurve(rx + ox, 0, width, ry - oy, width, ry),
    appendBezierCurve(width, ry + oy, rx + ox, height, rx, height),
    appendBezierCurve(rx - ox, height, 0, ry + oy, 0, ry),
    appendBezierCurve(0, ry - oy, rx - ox, 0, rx, 0),
    closePath(),
  ];
}

/** Arrow head dimensions for a given stroke width; shared with the on-screen rendering. */
export function arrowHead(strokeWidth: number): { length: number; width: number } {
  return { length: Math.max(8, strokeWidth * 4), width: Math.max(6, strokeWidth * 3) };
}

function shapeOperators(shape: ShapeObject): PDFOperator[] {
  const { width, height } = shape;
  const operators: PDFOperator[] = [setLineWidth(shape.strokeWidth), setLineJoin(LineJoinStyle.Miter)];
  if (shape.stroke) operators.push(setStrokingColor(parseColor(shape.stroke)));
  if (shape.fill) operators.push(setFillingColor(parseColor(shape.fill)));
  if (shape.dashed) operators.push(setDashPattern([shape.strokeWidth * 3, shape.strokeWidth * 2], 0));

  if (shape.shape === 'rect' || shape.shape === 'ellipse') {
    operators.push(...(shape.shape === 'rect' ? [rectangle(0, 0, width, height)] : ellipsePath(width, height)));
    if (shape.fill && shape.stroke) operators.push(fillAndStroke());
    else if (shape.fill) operators.push(fill());
    else if (shape.stroke) operators.push(stroke());
    return operators;
  }

  if (!shape.stroke) return [];
  const start = shape.flipped ? { x: 0, y: height } : { x: 0, y: 0 };
  const end = shape.flipped ? { x: width, y: 0 } : { x: width, y: height };
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (length === 0) return [];

  if (shape.shape === 'line') {
    operators.push(setLineCap(LineCapStyle.Round), moveTo(start.x, start.y), lineTo(end.x, end.y), stroke());
    return operators;
  }

  // Arrow: the shaft stops at the base of the head so the tip stays sharp.
  const head = arrowHead(shape.strokeWidth);
  const ux = (end.x - start.x) / length;
  const uy = (end.y - start.y) / length;
  const headLength = Math.min(head.length, length);
  const base = { x: end.x - ux * headLength, y: end.y - uy * headLength };
  operators.push(
    setLineCap(LineCapStyle.Butt),
    moveTo(start.x, start.y),
    lineTo(base.x, base.y),
    stroke(),
    setFillingColor(parseColor(shape.stroke)),
    setDashPattern([], 0),
    moveTo(end.x, end.y),
    lineTo(base.x - (uy * head.width) / 2, base.y + (ux * head.width) / 2),
    lineTo(base.x + (uy * head.width) / 2, base.y - (ux * head.width) / 2),
    closePath(),
    fill(),
  );
  return operators;
}

function pathOperators(path: PathObject): PDFOperator[] {
  const points: Array<[number, number]> = [];
  for (let index = 0; index + 1 < path.points.length; index += 2) {
    points.push([path.points[index]! * path.width, path.points[index + 1]! * path.height]);
  }
  const first = points[0];
  if (!first) return [];
  const operators: PDFOperator[] = [
    setStrokingColor(parseColor(path.stroke)),
    setLineWidth(path.strokeWidth),
    setLineCap(LineCapStyle.Round),
    setLineJoin(LineJoinStyle.Round),
    moveTo(first[0], first[1]),
  ];
  // A single point is drawn as a dot (a zero-length round-capped line).
  if (points.length === 1) operators.push(lineTo(first[0], first[1]));
  for (const [x, y] of points.slice(1)) operators.push(lineTo(x, y));
  operators.push(stroke());
  return operators;
}

async function drawText(page: PDFPage, text: TextObject, resources: DrawResources): Promise<void> {
  if (text.background) {
    page.pushOperators(
      pushGraphicsState(),
      setFillingColor(parseColor(text.background)),
      rectangle(0, 0, text.width, text.height),
      fill(),
      popGraphicsState(),
    );
  }
  const font = await resources.font(fontKey(text.fontFamily, text));
  const color = parseColor(text.color);
  for (const line of resources.textLines[text.id] ?? []) {
    if (line.text === '') continue;
    // Glyphs need a y-up frame: flip around the baseline of this line.
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(1, 0, 0, -1, line.x, line.baseline));
    page.drawText(line.text, { x: 0, y: 0, size: text.fontSize, font, color, opacity: text.opacity });
    page.pushOperators(popGraphicsState());
  }
}

/** Draws the objects of one page, bottom to top, as real PDF text, vector paths and images. */
export async function drawObjects(
  document: PDFDocument,
  page: PDFPage,
  box: PdfBox,
  objects: readonly EditorObject[],
  resources: DrawResources,
): Promise<void> {
  for (const object of objects) {
    // Notes and links are written as annotations (see annotations.ts), not painted.
    if (object.type === 'note' || object.type === 'link') continue;
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...localToPdfMatrix(object, box)));

    if (object.type === 'text') {
      // Text carries its own opacity; the background uses the shared state.
      page.pushOperators(...opacityState(document, page, object.opacity));
      await drawText(page, object, resources);
    } else if (object.type === 'image') {
      const image = await resources.image(object.assetId);
      // Images are defined bottom-up; flip the frame, plus any user-requested mirroring.
      const flipX = object.flipX ? -1 : 1;
      const flipY = object.flipY ? 1 : -1;
      page.pushOperators(
        concatTransformationMatrix(flipX, 0, 0, flipY, object.flipX ? object.width : 0, object.flipY ? 0 : object.height),
      );
      page.drawImage(image, { x: 0, y: 0, width: object.width, height: object.height, opacity: object.opacity });
    } else if (object.type === 'shape') {
      page.pushOperators(...opacityState(document, page, object.opacity), ...shapeOperators(object));
    } else {
      page.pushOperators(
        ...opacityState(document, page, object.opacity, object.highlighter),
        ...pathOperators(object),
      );
    }

    page.pushOperators(popGraphicsState());
  }
}
