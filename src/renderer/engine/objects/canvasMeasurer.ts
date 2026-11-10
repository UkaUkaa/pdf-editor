import { cssFont } from '@shared/fonts';
import { setTextMeasurer } from './textLayout';

/**
 * Measures text with the bundled fonts through a canvas, so that line breaks
 * computed here match what the browser draws and what is exported to PDF.
 * Call once the fonts have finished loading.
 */
export function installCanvasTextMeasurer(): void {
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return;
  setTextMeasurer((text, style) => {
    context.font = cssFont(style.fontFamily, style.fontSize, style);
    return context.measureText(text).width;
  });
}
