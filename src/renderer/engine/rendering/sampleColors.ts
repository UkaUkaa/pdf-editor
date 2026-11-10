import type { PageModel } from '@shared/types/document';
import { boundsOf, pageToDisplay, type Box } from '../objects/geometry';
import { renderPage } from './pageRenderer';

export interface SampledColors {
  /** Dominant colour around the region: what a cover has to look like to blend in. */
  background: string;
  /** Colour that differs most from the background: the ink of the text. */
  foreground: string;
}

export const DEFAULT_SAMPLE: SampledColors = { background: '#ffffff', foreground: '#000000' };

const SAMPLE_RESOLUTION = 2; // pixels per point
const hex = (r: number, g: number, b: number): string =>
  `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;

/**
 * Picks background and text colour from pixel data of a region. Pure, so it
 * can be tested without a canvas.
 */
export function analyseRegion(data: ArrayLike<number>, width: number, height: number): SampledColors {
  if (width <= 0 || height <= 0) return DEFAULT_SAMPLE;
  const at = (x: number, y: number): [number, number, number] => {
    const offset = (y * width + x) * 4;
    return [data[offset] ?? 255, data[offset + 1] ?? 255, data[offset + 2] ?? 255];
  };

  // Background: the most frequent colour on the border of the region (quantised to absorb anti-aliasing).
  const counts = new Map<number, { count: number; sum: [number, number, number] }>();
  const visit = (x: number, y: number): void => {
    const [r, g, b] = at(x, y);
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const entry = counts.get(key) ?? { count: 0, sum: [0, 0, 0] };
    entry.count += 1;
    entry.sum[0] += r;
    entry.sum[1] += g;
    entry.sum[2] += b;
    counts.set(key, entry);
  };
  for (let x = 0; x < width; x += 1) {
    visit(x, 0);
    visit(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    visit(0, y);
    visit(width - 1, y);
  }
  const dominant = [...counts.values()].sort((a, b) => b.count - a.count)[0];
  if (!dominant) return DEFAULT_SAMPLE;
  const background = dominant.sum.map((value) => Math.round(value / dominant.count)) as [number, number, number];

  // Foreground: the pixel furthest from the background.
  let best = 0;
  let foreground: [number, number, number] | null = null;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = at(x, y);
      const distance = Math.abs(r - background[0]) + Math.abs(g - background[1]) + Math.abs(b - background[2]);
      if (distance > best) {
        best = distance;
        foreground = [r, g, b];
      }
    }
  }
  const dark = background[0] + background[1] + background[2] < 384;
  return {
    background: hex(...background),
    // Too little contrast means there is no reliable ink colour: fall back to black or white.
    foreground: foreground && best >= 60 ? hex(...foreground) : dark ? '#ffffff' : '#000000',
  };
}

/** Samples the rendered page around a page-space box. Falls back to black on white if it cannot. */
export async function samplePageColors(documentId: string, page: PageModel, box: Box): Promise<SampledColors> {
  try {
    const bitmap = await renderPage(documentId, page, SAMPLE_RESOLUTION).promise;
    // The bitmap shows the page as displayed, so the box has to follow the page rotation.
    const corners = [
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y + box.height },
    ].map((corner) => pageToDisplay(corner, page.box, page.rotation));
    const display = boundsOf({ ...boxFromCorners(corners[0]!, corners[1]!), rotation: 0 });
    const scaleX = bitmap.width / (page.rotation === 90 || page.rotation === 270 ? page.box.height : page.box.width);
    const scaleY = bitmap.height / (page.rotation === 90 || page.rotation === 270 ? page.box.width : page.box.height);
    const x = Math.max(0, Math.floor(display.x * scaleX));
    const y = Math.max(0, Math.floor(display.y * scaleY));
    const width = Math.min(bitmap.width - x, Math.ceil(display.width * scaleX));
    const height = Math.min(bitmap.height - y, Math.ceil(display.height * scaleY));
    if (width <= 0 || height <= 0) return DEFAULT_SAMPLE;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return DEFAULT_SAMPLE;
    // Pages are drawn on white paper; transparent areas of the bitmap are that paper.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, x, y, width, height, 0, 0, width, height);
    return analyseRegion(context.getImageData(0, 0, width, height).data, width, height);
  } catch {
    return DEFAULT_SAMPLE;
  }
}

function boxFromCorners(a: { x: number; y: number }, b: { x: number; y: number }): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}
