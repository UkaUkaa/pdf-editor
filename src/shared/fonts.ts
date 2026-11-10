import { FONT_FAMILIES, type BuiltInFontFamily, type FontFamily } from './types/objects';

/**
 * Fonts of text objects.
 *
 * Three families are bundled with the application (DejaVu, Bitstream Vera
 * licence): they cover Latin and Cyrillic including Ukrainian and are always
 * available. Any other family comes from the fonts installed on the computer
 * (see `main/services/systemFonts.ts`). The same font files are used on screen
 * and embedded into exported PDFs, so both match.
 */
export interface FontVariant {
  bold: boolean;
  italic: boolean;
}

const FILES: Record<BuiltInFontFamily, [regular: string, bold: string, italic: string, boldItalic: string]> = {
  sans: ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf', 'DejaVuSans-Oblique.ttf', 'DejaVuSans-BoldOblique.ttf'],
  serif: ['DejaVuSerif.ttf', 'DejaVuSerif-Bold.ttf', 'DejaVuSerif-Italic.ttf', 'DejaVuSerif-BoldItalic.ttf'],
  mono: [
    'DejaVuSansMono.ttf',
    'DejaVuSansMono-Bold.ttf',
    'DejaVuSansMono-Oblique.ttf',
    'DejaVuSansMono-BoldOblique.ttf',
  ],
};

export const isBuiltInFont = (family: FontFamily): family is BuiltInFontFamily =>
  (FONT_FAMILIES as readonly string[]).includes(family);

/** CSS family names registered through `@font-face` in the renderer. */
export const CSS_FONT_FAMILY: Record<BuiltInFontFamily, string> = {
  sans: 'PDF Editor Sans',
  serif: 'PDF Editor Serif',
  mono: 'PDF Editor Mono',
};

/** Shown instead of a family that is not installed on this computer. */
export const FALLBACK_FONT: BuiltInFontFamily = 'sans';

/**
 * CSS name under which a system family is registered by the application. It is
 * deliberately not the plain family name: the browser must use exactly the
 * file that will be embedded, never its own idea of a local font.
 */
export const systemCssFamily = (family: string): string => `PDF Editor · ${family.replace(/["\\\n\r]/g, '_')}`;

/** CSS `font-family` value for a text object's font, with the bundled fallback behind it. */
export function cssFontFamily(family: FontFamily): string {
  if (isBuiltInFont(family)) return `"${CSS_FONT_FAMILY[family]}"`;
  return `"${systemCssFamily(family)}", "${CSS_FONT_FAMILY[FALLBACK_FONT]}"`;
}

/** Ascender of the DejaVu faces, as a fraction of the font size. */
export const FONT_ASCENT = 1901 / 2048;
export const FONT_DESCENT = 483 / 2048;

const ascents = new Map<string, number>();

/** Records the ascender of a system family (reported by the font catalogue). */
export function setFontAscent(family: string, ascent: number): void {
  ascents.set(family, ascent);
}

/** Ascender of a family as a fraction of the font size; places the first baseline of a text object. */
export function fontAscent(family: FontFamily): number {
  return isBuiltInFont(family) ? FONT_ASCENT : (ascents.get(family) ?? FONT_ASCENT);
}

/** File name of a bundled font face. */
export function fontFileName(family: BuiltInFontFamily, { bold, italic }: FontVariant): string {
  return FILES[family][(bold ? 1 : 0) + (italic ? 2 : 0)]!;
}

/**
 * Key under which the bytes of a face travel to the PDF export: the file name
 * for bundled fonts, a `system:` key for installed ones.
 */
export function fontKey(family: FontFamily, variant: FontVariant): string {
  if (isBuiltInFont(family)) return fontFileName(family, variant);
  return `system:${family}:${variant.bold ? 'b' : ''}${variant.italic ? 'i' : ''}`;
}

export const ALL_FONT_FILES: string[] = Object.values(FILES).flat();

/** CSS `font` shorthand, e.g. for canvas text measurement. */
export function cssFont(family: FontFamily, size: number, { bold, italic }: FontVariant): string {
  return `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px ${cssFontFamily(family)}`;
}
