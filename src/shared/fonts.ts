import type { FontFamily } from './types/objects';

/**
 * Fonts bundled with the application (DejaVu, Bitstream Vera licence). They
 * cover Latin and Cyrillic including Ukrainian, may be embedded in documents,
 * and are used both on screen and in exported PDFs, so both match.
 */
export interface FontVariant {
  bold: boolean;
  italic: boolean;
}

const FILES: Record<FontFamily, [regular: string, bold: string, italic: string, boldItalic: string]> = {
  sans: ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf', 'DejaVuSans-Oblique.ttf', 'DejaVuSans-BoldOblique.ttf'],
  serif: ['DejaVuSerif.ttf', 'DejaVuSerif-Bold.ttf', 'DejaVuSerif-Italic.ttf', 'DejaVuSerif-BoldItalic.ttf'],
  mono: [
    'DejaVuSansMono.ttf',
    'DejaVuSansMono-Bold.ttf',
    'DejaVuSansMono-Oblique.ttf',
    'DejaVuSansMono-BoldOblique.ttf',
  ],
};

/** CSS family names registered through `@font-face` in the renderer. */
export const CSS_FONT_FAMILY: Record<FontFamily, string> = {
  sans: 'PDF Editor Sans',
  serif: 'PDF Editor Serif',
  mono: 'PDF Editor Mono',
};

/** Vertical metrics shared by all DejaVu faces, as fractions of the font size. */
export const FONT_ASCENT = 1901 / 2048;
export const FONT_DESCENT = 483 / 2048;

export function fontFileName(family: FontFamily, { bold, italic }: FontVariant): string {
  return FILES[family][(bold ? 1 : 0) + (italic ? 2 : 0)]!;
}

export const ALL_FONT_FILES: string[] = Object.values(FILES).flat();

/** CSS `font` shorthand, e.g. for canvas text measurement. */
export function cssFont(family: FontFamily, size: number, { bold, italic }: FontVariant): string {
  return `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px "${CSS_FONT_FAMILY[family]}"`;
}
