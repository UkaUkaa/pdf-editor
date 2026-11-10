import { FONT_ASCENT } from '@shared/fonts';
import type { RecognisedLine } from '@shared/types/document';
import { TEXT_PADDING, type EditorObject, type TextObject, type ToolStyle } from '@shared/types/objects';
import { createTextObject, fitTextHeight } from './factory';
import { containsPoint, type Box } from './geometry';
import { measureText } from './textLayout';

/**
 * Replacing a line of original text: the line is covered by a text object on a
 * background in the colour of the page. This is an overlay; the original text
 * stays in the file underneath.
 */

/** Line height of replacement text; tall enough for the cover to hide descenders of the original. */
export const REPLACEMENT_LINE_HEIGHT = 1.3;

/** Box of a line in page space: what has to be covered to hide the original glyphs. */
export function runBox(run: RecognisedLine): Box {
  const lineAdvance = run.fontSize * REPLACEMENT_LINE_HEIGHT;
  const baselineOffset = TEXT_PADDING + (lineAdvance - run.fontSize) / 2 + run.fontSize * FONT_ASCENT;
  return {
    x: run.x - TEXT_PADDING,
    y: run.baseline - baselineOffset,
    width: run.width + TEXT_PADDING * 2,
    height: lineAdvance + TEXT_PADDING * 2,
  };
}

/** Whether a line already has a replacement object lying over it. */
export function isRunCovered(run: RecognisedLine, objects: readonly EditorObject[]): boolean {
  const box = runBox(run);
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  return objects.some((object) => object.type === 'text' && object.replacesOriginal && containsPoint(object, centre));
}

/**
 * Builds the text object that replaces a line: same position, baseline and
 * size, in the closest bundled font, on a cover in the given background colour.
 */
export function createReplacement(
  run: RecognisedLine,
  colors: { background: string; foreground: string },
  style: ToolStyle,
  text = run.text,
): TextObject {
  const box = runBox(run);
  const base: TextObject = {
    ...createTextObject({ x: box.x, y: box.y }, style, text),
    fontFamily: run.fontFamily,
    fontSize: run.fontSize,
    lineHeight: REPLACEMENT_LINE_HEIGHT,
    color: colors.foreground,
    background: colors.background,
    replacesOriginal: true,
  };
  // The cover must hide the whole original line, and the new text must not wrap.
  const needed = Math.max(...text.split('\n').map((line) => measureText(line, base))) + TEXT_PADDING * 2 + 1;
  return fitTextHeight({ ...base, width: Math.max(box.width, needed) });
}
