import { fontAscent } from '@shared/fonts';
import { TEXT_PADDING, type TextObject } from '@shared/types/objects';

/** Returns the width of a string in points for the given text style. */
export type TextMeasurer = (text: string, style: Pick<TextObject, 'fontFamily' | 'fontSize' | 'bold' | 'italic'>) => number;

export interface TextLine {
  text: string;
  /** Left edge of the line and position of its baseline, in object-local points. */
  x: number;
  baseline: number;
  width: number;
}

export interface TextLayout {
  lines: TextLine[];
  /** Height the object needs to show all lines. */
  height: number;
}

/** Rough estimate used until the real measurer is installed (and in unit tests, which have no fonts). */
const approximate: TextMeasurer = (text, style) => text.length * style.fontSize * (style.fontFamily === 'mono' ? 0.6 : 0.55);

let measurer: TextMeasurer = approximate;

/** Installs the measurer backed by the real bundled fonts (see `canvasMeasurer.ts`). */
export function setTextMeasurer(next: TextMeasurer | null): void {
  measurer = next ?? approximate;
}

export const measureText: TextMeasurer = (text, style) => measurer(text, style);

/** Greedy word wrapping. Words longer than the line are broken between characters. */
export function wrapText(text: string, maxWidth: number, measure: (text: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    // Keep runs of spaces attached to the word before them, like a text editor does.
    const tokens = paragraph.match(/\S+\s*/g) ?? [];
    let line = paragraph.match(/^\s*/)?.[0] ?? '';
    for (const token of tokens) {
      if (line !== '' && measure((line + token).trimEnd()) > maxWidth) {
        lines.push(line.trimEnd());
        line = '';
      }
      if (measure(token.trimEnd()) <= maxWidth) {
        line += token;
        continue;
      }
      // The word alone does not fit: break it between characters (by code point).
      for (const character of token) {
        if (line !== '' && measure(line + character) > maxWidth) {
          lines.push(line);
          line = '';
        }
        line += character;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

/**
 * Lays out a text object. The same result drives the screen rendering and the
 * PDF export, which is what keeps line breaks identical in both.
 */
export function layoutText(object: TextObject, measure: TextMeasurer = measureText): TextLayout {
  const available = Math.max(1, object.width - TEXT_PADDING * 2);
  const measureLine = (text: string): number => measure(text, object);
  const lineAdvance = object.fontSize * object.lineHeight;
  // Centre the glyph box within each line slot, as browsers do for line-height.
  const firstBaseline = TEXT_PADDING + (lineAdvance - object.fontSize) / 2 + object.fontSize * fontAscent(object.fontFamily);

  const lines = wrapText(object.text, available, measureLine).map((text, index) => {
    const width = measureLine(text);
    const free = available - width;
    const offset = object.align === 'center' ? free / 2 : object.align === 'right' ? free : 0;
    return { text, x: TEXT_PADDING + Math.max(0, offset), baseline: firstBaseline + index * lineAdvance, width };
  });
  return { lines, height: lines.length * lineAdvance + TEXT_PADDING * 2 };
}
