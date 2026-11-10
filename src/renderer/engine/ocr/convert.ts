import type { PageModel, RecognisedLine } from '@shared/types/document';
import { displaySize, pageGeometry } from '../coordinates/pageCoordinates';
import { displayToPage } from '../objects/geometry';

/** A line as the OCR engine reports it, in pixels of the image it was given. */
export interface OcrLine {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  /** End points of the baseline, when the engine provides them. */
  baseline?: { x0: number; y0: number; x1: number; y1: number };
}

/**
 * Converts OCR output for an image of a page (rendered as displayed, i.e. with
 * the page rotation applied) into lines in page space.
 */
export function toRecognisedLines(lines: readonly OcrLine[], page: PageModel, imageWidth: number): RecognisedLine[] {
  const display = displaySize(pageGeometry(page));
  if (imageWidth <= 0) return [];
  const pointsPerPixel = display.width / imageWidth;
  // Text that reads left to right on the displayed page runs at this angle in unrotated page space.
  const angle = (360 - page.rotation) % 360;

  const result: RecognisedLine[] = [];
  for (const line of lines) {
    const text = line.text.replace(/\s+/g, ' ').trim();
    const width = (line.bbox.x1 - line.bbox.x0) * pointsPerPixel;
    const height = (line.bbox.y1 - line.bbox.y0) * pointsPerPixel;
    if (text === '' || width <= 0 || height <= 0) continue;
    // The box spans ascenders to descenders; the baseline sits about a fifth above its bottom.
    const baselinePixels = line.baseline ? (line.baseline.y0 + line.baseline.y1) / 2 : line.bbox.y1 - (line.bbox.y1 - line.bbox.y0) * 0.2;
    const start = displayToPage({ x: line.bbox.x0 * pointsPerPixel, y: baselinePixels * pointsPerPixel }, page.box, page.rotation);
    result.push({ text, x: start.x, baseline: start.y, angle, width, fontSize: Math.max(1, height * 0.8), fontFamily: 'sans' });
  }
  return result;
}
