import { describe, expect, it } from 'vitest';
import type { PageRotation } from '@shared/types/document';
import {
  displaySize,
  displaySizeInMillimetres,
  normaliseRotation,
  pdfToView,
  viewSize,
  viewToDevice,
  viewToPdf,
  type PageGeometry,
} from '@renderer/engine/coordinates/pageCoordinates';

// A page whose box does not start at the origin, as produced by cropping.
const box = { x: 10, y: 20, width: 200, height: 400 };
const geometry = (rotation: PageRotation): PageGeometry => ({ box, rotation });
const corners = {
  bottomLeft: { x: 10, y: 20 },
  bottomRight: { x: 210, y: 20 },
  topLeft: { x: 10, y: 420 },
  topRight: { x: 210, y: 420 },
};

describe('page coordinates', () => {
  it('swaps width and height for quarter turns', () => {
    expect(displaySize(geometry(0))).toEqual({ width: 200, height: 400 });
    expect(displaySize(geometry(90))).toEqual({ width: 400, height: 200 });
    expect(displaySize(geometry(180))).toEqual({ width: 200, height: 400 });
    expect(displaySize(geometry(270))).toEqual({ width: 400, height: 200 });
    expect(viewSize(geometry(90), 2)).toEqual({ width: 800, height: 400 });
  });

  it('maps PDF corners to the view for every rotation (clockwise page rotation)', () => {
    // rotation 0: PDF top-left is the view origin.
    expect(pdfToView(geometry(0), 1, corners.topLeft)).toEqual({ x: 0, y: 0 });
    expect(pdfToView(geometry(0), 1, corners.bottomRight)).toEqual({ x: 200, y: 400 });
    // rotation 90: the PDF bottom-left corner moves to the view's top-left.
    expect(pdfToView(geometry(90), 1, corners.bottomLeft)).toEqual({ x: 0, y: 0 });
    expect(pdfToView(geometry(90), 1, corners.topLeft)).toEqual({ x: 400, y: 0 });
    expect(pdfToView(geometry(90), 1, corners.topRight)).toEqual({ x: 400, y: 200 });
    // rotation 180: the PDF bottom-right corner moves to the view's top-left.
    expect(pdfToView(geometry(180), 1, corners.bottomRight)).toEqual({ x: 0, y: 0 });
    expect(pdfToView(geometry(180), 1, corners.topLeft)).toEqual({ x: 200, y: 400 });
    // rotation 270: the PDF top-right corner moves to the view's top-left.
    expect(pdfToView(geometry(270), 1, corners.topRight)).toEqual({ x: 0, y: 0 });
    expect(pdfToView(geometry(270), 1, corners.bottomLeft)).toEqual({ x: 400, y: 200 });
  });

  it('applies the scale and stays inside the view rectangle', () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      const size = viewSize(geometry(rotation), 1.5);
      for (const corner of Object.values(corners)) {
        const point = pdfToView(geometry(rotation), 1.5, corner);
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(size.width);
        expect(point.y).toBeLessThanOrEqual(size.height);
      }
    }
  });

  it('round-trips arbitrary points for every rotation and scale', () => {
    const points = [
      { x: 10, y: 20 },
      { x: 57.25, y: 301.5 },
      { x: 210, y: 420 },
      { x: -5, y: 500 },
    ];
    for (const rotation of [0, 90, 180, 270] as const) {
      for (const scale of [0.1, 1, 1.3333, 6.4]) {
        for (const point of points) {
          const back = viewToPdf(geometry(rotation), scale, pdfToView(geometry(rotation), scale, point));
          expect(back.x).toBeCloseTo(point.x, 9);
          expect(back.y).toBeCloseTo(point.y, 9);
        }
      }
    }
  });

  it('normalises rotations and converts to device pixels and millimetres', () => {
    expect(normaliseRotation(-90)).toBe(270);
    expect(normaliseRotation(450)).toBe(90);
    expect(normaliseRotation(360)).toBe(0);
    expect(normaliseRotation(89)).toBe(90);
    expect(viewToDevice({ x: 10, y: 20 }, 2)).toEqual({ x: 20, y: 40 });
    const a4 = { box: { x: 0, y: 0, width: 595.28, height: 841.89 }, rotation: 0 as const };
    expect(displaySizeInMillimetres(a4)).toEqual({ width: 210, height: 297 });
    expect(displaySizeInMillimetres({ ...a4, rotation: 90 })).toEqual({ width: 297, height: 210 });
  });
});
