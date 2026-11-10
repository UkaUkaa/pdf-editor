import { describe, expect, it } from 'vitest';
import type { EditorObject, ShapeObject, TextObject } from '@shared/types/objects';
import { DEFAULT_TOOL_STYLE } from '@shared/types/objects';
import { pdfToView } from '@renderer/engine/coordinates/pageCoordinates';
import { alignObjects, distributeObjects, restack } from '@renderer/engine/objects/arrange';
import {
  cloneObjects,
  createImageObject,
  createPathObject,
  createShapeObject,
  createTextObject,
  normaliseObject,
} from '@renderer/engine/objects/factory';
import {
  boundsOf,
  boxesIntersect,
  containsPoint,
  cornersOf,
  displayToPage,
  handlePosition,
  pageToDisplay,
  resizeObject,
  rotatePoint,
  rotationTowards,
  RESIZE_HANDLES,
  unionBounds,
} from '@renderer/engine/objects/geometry';
import { layoutText, wrapText } from '@renderer/engine/objects/textLayout';
import { mergeTextRuns } from '@renderer/engine/pdf/textRuns';
import { analyseRegion } from '@renderer/engine/rendering/sampleColors';

const shape = (patch: Partial<ShapeObject> = {}): ShapeObject => ({
  id: patch.id ?? 's',
  layerId: 'layer',
  type: 'shape',
  shape: 'rect',
  x: 100,
  y: 50,
  width: 200,
  height: 100,
  rotation: 0,
  opacity: 1,
  stroke: '#000000',
  strokeWidth: 1,
  fill: null,
  dashed: false,
  flipped: false,
  ...patch,
});
const close = (actual: { x: number; y: number }, expected: { x: number; y: number }): void => {
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
};

describe('geometry', () => {
  it('rotates clockwise in a y-down frame and computes rotated bounds', () => {
    close(rotatePoint({ x: 1, y: 0 }, { x: 0, y: 0 }, 90), { x: 0, y: 1 });
    const turned = shape({ rotation: 90 });
    const bounds = boundsOf(turned);
    // 200x100 turned a quarter around its centre (200,100) becomes 100x200.
    expect(bounds.x).toBeCloseTo(150);
    expect(bounds.y).toBeCloseTo(0);
    expect(bounds.width).toBeCloseTo(100);
    expect(bounds.height).toBeCloseTo(200);
    close(cornersOf(turned)[0]!, { x: 250, y: 0 });
    expect(unionBounds([shape(), shape({ x: 400, y: 300 })])).toEqual({ x: 100, y: 50, width: 500, height: 350 });
    expect(unionBounds([])).toBeNull();
  });

  it('hit-tests rotated objects', () => {
    const turned = shape({ rotation: 90 });
    expect(containsPoint(turned, { x: 200, y: 10 })).toBe(true);
    expect(containsPoint(turned, { x: 110, y: 100 })).toBe(false);
    expect(containsPoint(shape(), { x: 110, y: 100 })).toBe(true);
    expect(boxesIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 10, width: 5, height: 5 })).toBe(true);
    expect(boxesIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 11, y: 0, width: 5, height: 5 })).toBe(false);
  });

  it('keeps the opposite handle fixed while resizing, for every handle and rotation', () => {
    const opposite: Record<string, (typeof RESIZE_HANDLES)[number]> = { nw: 'se', n: 's', ne: 'sw', e: 'w', se: 'nw', s: 'n', sw: 'ne', w: 'e' };
    for (const rotation of [0, 30, 90, 213]) {
      const original = shape({ rotation });
      for (const handle of RESIZE_HANDLES) {
        const anchor = handlePosition(original, opposite[handle]!);
        const grabbed = handlePosition(original, handle);
        // Drag the handle 40pt right and 25pt down in page space.
        const resized = resizeObject(original, handle, { x: grabbed.x + 40, y: grabbed.y + 25 });
        close(handlePosition(resized, opposite[handle]!), anchor);
        expect(resized.rotation).toBe(rotation);
      }
    }
  });

  it('follows the pointer, enforces a minimum size and can keep proportions', () => {
    const grown = resizeObject(shape(), 'se', { x: 350, y: 250 });
    expect(grown).toMatchObject({ x: 100, y: 50, width: 250, height: 200 });
    const collapsed = resizeObject(shape(), 'e', { x: -500, y: 0 });
    expect(collapsed.width).toBe(4);
    expect(collapsed.x).toBe(100);
    const proportional = resizeObject(shape(), 'se', { x: 500, y: 160 }, { keepAspect: true });
    expect(proportional.width / proportional.height).toBeCloseTo(2);
    expect(proportional).toMatchObject({ x: 100, y: 50, width: 400 });
    const fromEdge = resizeObject(shape(), 'e', { x: 500, y: 0 }, { keepAspect: true });
    expect(fromEdge).toMatchObject({ width: 400, height: 200, y: 0 });
  });

  it('computes rotation from the pointer and snaps on request', () => {
    const object = shape();
    expect(rotationTowards(object, { x: 200, y: 0 }, false)).toBe(0);
    expect(rotationTowards(object, { x: 400, y: 100 }, false)).toBe(90);
    expect(rotationTowards(object, { x: 200, y: 400 }, false)).toBe(180);
    expect(rotationTowards(object, { x: 0, y: 100 }, false)).toBe(270);
    expect(rotationTowards(object, { x: 260, y: 0 }, true) % 15).toBe(0);
  });

  it('maps page space to the displayed page consistently with the PDF coordinate module', () => {
    const page = { x: 10, y: 20, width: 300, height: 500 };
    const point = { x: 40, y: 70 };
    for (const rotation of [0, 90, 180, 270] as const) {
      const display = pageToDisplay(point, page, rotation);
      close(displayToPage(display, page, rotation), point);
      // Page space is PDF space measured from the top-left corner of the page box.
      const viaPdf = pdfToView({ box: page, rotation }, 1, { x: page.x + point.x, y: page.y + page.height - point.y });
      close(display, viaPdf);
    }
  });
});

describe('arranging', () => {
  const objects: EditorObject[] = ['a', 'b', 'c', 'd'].map((id, index) => shape({ id, x: index * 50, y: index * 30, width: 20, height: 10 }));
  const order = (list: EditorObject[]): string => list.map((object) => object.id).join('');
  const page = { x: 0, y: 0, width: 600, height: 800 };

  it('changes the stacking order', () => {
    expect(order(restack(objects, new Set(['a']), 'front'))).toBe('bcda');
    expect(order(restack(objects, new Set(['d']), 'back'))).toBe('dabc');
    expect(order(restack(objects, new Set(['b']), 'forward'))).toBe('acbd');
    expect(order(restack(objects, new Set(['b', 'c']), 'forward'))).toBe('adbc');
    expect(order(restack(objects, new Set(['c']), 'backward'))).toBe('acbd');
    expect(order(restack(objects, new Set(['d']), 'forward'))).toBe('abcd');
    expect(order(restack(objects, new Set(['a']), 'backward'))).toBe('abcd');
  });

  it('aligns to the common bounds, or to the page for a single object', () => {
    const left = alignObjects(objects, new Set(['b', 'd']), 'left', page);
    expect(left.map((object) => object.x)).toEqual([0, 50, 100, 50]);
    expect(left[0]).toBe(objects[0]);
    const centred = alignObjects(objects, new Set(['a']), 'center', page);
    expect(centred[0]!.x).toBe(290);
    const bottom = alignObjects(objects, new Set(['a']), 'bottom', page);
    expect(bottom[0]!.y).toBe(790);
    // Rotated objects align by their visual bounds.
    const turned = [shape({ id: 't', x: 100, y: 100, width: 200, height: 100, rotation: 90 })];
    expect(boundsOf(alignObjects(turned, new Set(['t']), 'left', page)[0]!).x).toBeCloseTo(0);
  });

  it('distributes three or more objects with equal gaps', () => {
    const uneven = [shape({ id: 'a', x: 0, width: 20 }), shape({ id: 'b', x: 30, width: 20 }), shape({ id: 'c', x: 180, width: 20 })];
    const result = distributeObjects(uneven, new Set(['a', 'b', 'c']), 'horizontal');
    expect(result.map((object) => object.x)).toEqual([0, 90, 180]);
    expect(distributeObjects(uneven, new Set(['a', 'b']), 'horizontal').map((object) => object.x)).toEqual([0, 30, 180]);
  });
});

describe('text layout', () => {
  const measure = (text: string): number => text.length * 10;

  it('wraps on words, keeps explicit line breaks and breaks over-long words', () => {
    expect(wrapText('aaa bbb ccc', 70, measure)).toEqual(['aaa bbb', 'ccc']);
    expect(wrapText('aaa bbb\n\nccc', 200, measure)).toEqual(['aaa bbb', '', 'ccc']);
    expect(wrapText('abcdefghij', 40, measure)).toEqual(['abcd', 'efgh', 'ij']);
    expect(wrapText('', 40, measure)).toEqual(['']);
    expect(wrapText('привет мир', 60, measure)).toEqual(['привет', 'мир']);
  });

  it('positions lines by alignment and sizes the box to its lines', () => {
    const text: TextObject = { ...createTextObject({ x: 0, y: 0 }, DEFAULT_TOOL_STYLE, 'ab\nabcd'), width: 104, fontSize: 10, lineHeight: 1.5 };
    const fixed = (value: string): number => value.length * 10;
    const left = layoutText(text, fixed);
    expect(left.lines.map((line) => line.x)).toEqual([2, 2]);
    expect(left.height).toBe(2 * 15 + 4);
    expect(left.lines[1]!.baseline - left.lines[0]!.baseline).toBe(15);
    expect(layoutText({ ...text, align: 'right' }, fixed).lines.map((line) => line.x)).toEqual([82, 62]);
    expect(layoutText({ ...text, align: 'center' }, fixed).lines.map((line) => line.x)).toEqual([42, 32]);
  });

  it('grows replacement text boxes instead of wrapping them', () => {
    const replacement = normaliseObject({ ...createTextObject({ x: 0, y: 0 }, DEFAULT_TOOL_STYLE, 'short'), width: 40, replacesOriginal: true });
    const longer = normaliseObject({ ...replacement, text: 'a considerably longer replacement' });
    expect(longer.width).toBeGreaterThan(replacement.width);
    expect(layoutText(longer).lines).toHaveLength(1);
    // Ordinary text boxes keep their width and wrap.
    const ordinary = normaliseObject({ ...longer, replacesOriginal: false, width: 60 });
    expect(ordinary.width).toBe(60);
    expect(layoutText(ordinary).lines.length).toBeGreaterThan(1);
  });
});

describe('object factory', () => {
  it('creates shapes from a drag and default-sized shapes from a click', () => {
    const dragged = createShapeObject('rect', { x: 200, y: 300 }, { x: 100, y: 100 }, DEFAULT_TOOL_STYLE);
    expect(dragged).toMatchObject({ x: 100, y: 100, width: 100, height: 200, flipped: false });
    const clicked = createShapeObject('ellipse', { x: 200, y: 300 }, { x: 201, y: 300 }, DEFAULT_TOOL_STYLE);
    expect(clicked).toMatchObject({ x: 140, y: 260, width: 120, height: 80 });
    // Dragging up and to the right runs along the other diagonal of the box.
    expect(createShapeObject('arrow', { x: 0, y: 100 }, { x: 100, y: 0 }, DEFAULT_TOOL_STYLE).flipped).toBe(true);
    expect(createShapeObject('line', { x: 0, y: 0 }, { x: 100, y: 0 }, DEFAULT_TOOL_STYLE)).toMatchObject({ height: 0, fill: null });
  });

  it('normalises freehand points to the stroke box', () => {
    const path = createPathObject([{ x: 10, y: 20 }, { x: 110, y: 70 }, { x: 60, y: 20 }], DEFAULT_TOOL_STYLE, false)!;
    expect(path).toMatchObject({ x: 10, y: 20, width: 100, height: 50, opacity: 1, highlighter: false });
    expect(path.points).toEqual([0, 0, 1, 1, 0.5, 0]);
    const marker = createPathObject([{ x: 0, y: 0 }], DEFAULT_TOOL_STYLE, true)!;
    expect(marker).toMatchObject({ highlighter: true, opacity: 0.4, stroke: DEFAULT_TOOL_STYLE.highlightColor });
    expect(createPathObject([], DEFAULT_TOOL_STYLE, false)).toBeNull();
  });

  it('fits images into the page without enlarging them, and clones with new ids', () => {
    const big = createImageObject('a', { width: 4000, height: 2000 }, { width: 600, height: 800 });
    expect(big).toMatchObject({ width: 360, height: 180, x: 120, y: 310 });
    expect(createImageObject('a', { width: 100, height: 50 }, { width: 600, height: 800 })).toMatchObject({ width: 100, height: 50 });
    const [copy] = cloneObjects([big], 12, 12);
    expect(copy).toMatchObject({ x: 132, y: 322, assetId: 'a' });
    expect(copy!.id).not.toBe(big.id);
  });
});

describe('reading original text', () => {
  const run = (text: string, x: number, width: number, baseline = 100, fontSize = 10) => ({ text, x, baseline, angle: 0, width, fontSize, fontFamily: 'sans' as const });

  it('merges fragments of one line and inserts the word spaces PDFs leave out', () => {
    const merged = mergeTextRuns([run('world', 41, 30), run('Hello', 10, 28), run('!', 71, 4), run('Next line', 10, 50, 115)]);
    expect(merged.map((item) => item.text)).toEqual(['Hello world!', 'Next line']);
    expect(merged[0]).toMatchObject({ x: 10, width: 65 });
  });

  it('keeps distant columns and different sizes apart', () => {
    expect(mergeTextRuns([run('Left', 10, 20), run('Right', 300, 30)])).toHaveLength(2);
    expect(mergeTextRuns([run('Big', 10, 20, 100, 20), run('small', 32, 20, 100, 10)])).toHaveLength(2);
  });

  it('samples the background from the border and the ink from the most different pixel', () => {
    // 5x3 region: light-grey paper with one dark-blue "ink" pixel in the middle.
    const pixels: number[] = [];
    for (let index = 0; index < 15; index += 1) pixels.push(...(index === 7 ? [10, 20, 120, 255] : [240, 240, 240, 255]));
    expect(analyseRegion(pixels, 5, 3)).toEqual({ background: '#f0f0f0', foreground: '#0a1478' });
    // No contrast at all: fall back to black on light, white on dark.
    expect(analyseRegion(new Array(60).fill(250), 5, 3).foreground).toBe('#000000');
    expect(analyseRegion(Array.from({ length: 60 }, (_, index) => (index % 4 === 3 ? 255 : 12)), 5, 3)).toEqual({ background: '#0c0c0c', foreground: '#ffffff' });
  });
});
