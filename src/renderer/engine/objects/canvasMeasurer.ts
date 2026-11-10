import { cssFont } from '@shared/fonts';
import { effectiveVariant } from '../fonts/fontRegistry';
import { setTextMeasurer } from './textLayout';

/**
 * Measures text with the real font files through a canvas, so that line breaks
 * computed here match what the browser draws and what is exported to PDF.
 * Call once the fonts have finished loading.
 */
export function installCanvasTextMeasurer(): void {
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return;
  setTextMeasurer((text, style) => {
    // Measured with the style that is really drawn (a family may lack a bold or italic face).
    context.font = cssFont(style.fontFamily, style.fontSize, effectiveVariant(style.fontFamily, style));
    return context.measureText(text).width;
  });
}
