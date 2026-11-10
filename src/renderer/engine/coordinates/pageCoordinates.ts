import type { PageModel, PageRotation, PdfBox } from '@shared/types/document';

/**
 * Coordinate systems used by the editor:
 *
 *  - PDF space:  points (1/72 inch), origin at the bottom-left of the page, y up.
 *                Coordinates are absolute, i.e. they include the page box offset.
 *  - View space: CSS pixels relative to the top-left corner of the page *as
 *                displayed* (after rotation), y down. `scale` is CSS pixels per point.
 *  - Device space: view space multiplied by `devicePixelRatio` (canvas pixels).
 *
 * Every conversion between them goes through this module, so the viewer, the
 * editing canvas and the export engine can never disagree.
 */

/** CSS reference pixels per PDF point: 100 % zoom shows the page at its physical size. */
export const CSS_PIXELS_PER_POINT = 96 / 72;
export const MILLIMETRES_PER_POINT = 25.4 / 72;

export interface PageGeometry {
  box: PdfBox;
  rotation: PageRotation;
}

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export function normaliseRotation(degrees: number): PageRotation {
  const snapped = (((Math.round(degrees / 90) * 90) % 360) + 360) % 360;
  return snapped as PageRotation;
}

/** Size of the page in points as displayed, i.e. with width and height swapped for 90°/270°. */
export function displaySize({ box, rotation }: PageGeometry): Size {
  return rotation === 90 || rotation === 270
    ? { width: box.height, height: box.width }
    : { width: box.width, height: box.height };
}

export function viewSize(geometry: PageGeometry, scale: number): Size {
  const size = displaySize(geometry);
  return { width: size.width * scale, height: size.height * scale };
}

export function pdfToView({ box, rotation }: PageGeometry, scale: number, point: Point): Point {
  const dx = point.x - box.x;
  const dy = point.y - box.y;
  switch (rotation) {
    case 0:
      return { x: dx * scale, y: (box.height - dy) * scale };
    case 90:
      return { x: dy * scale, y: dx * scale };
    case 180:
      return { x: (box.width - dx) * scale, y: dy * scale };
    case 270:
      return { x: (box.height - dy) * scale, y: (box.width - dx) * scale };
  }
}

export function viewToPdf({ box, rotation }: PageGeometry, scale: number, point: Point): Point {
  const vx = point.x / scale;
  const vy = point.y / scale;
  switch (rotation) {
    case 0:
      return { x: box.x + vx, y: box.y + box.height - vy };
    case 90:
      return { x: box.x + vy, y: box.y + vx };
    case 180:
      return { x: box.x + box.width - vx, y: box.y + vy };
    case 270:
      return { x: box.x + box.width - vy, y: box.y + box.height - vx };
  }
}

export function viewToDevice(point: Point, devicePixelRatio: number): Point {
  return { x: point.x * devicePixelRatio, y: point.y * devicePixelRatio };
}

export function pageGeometry(page: PageModel): PageGeometry {
  return { box: page.box, rotation: page.rotation };
}

/** Page dimensions in whole millimetres, as displayed. */
export function displaySizeInMillimetres(geometry: PageGeometry): Size {
  const size = displaySize(geometry);
  return {
    width: Math.round(size.width * MILLIMETRES_PER_POINT),
    height: Math.round(size.height * MILLIMETRES_PER_POINT),
  };
}
