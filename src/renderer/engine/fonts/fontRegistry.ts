import { create } from 'zustand';
import { isBuiltInFont, setFontAscent, systemCssFamily, type FontVariant } from '@shared/fonts';
import type { SystemFontFamily } from '@shared/types/fonts';
import type { FontFamily } from '@shared/types/objects';

/**
 * Fonts installed on the computer, as far as the application uses them.
 *
 * The list of families comes from the main process once. The font files of a
 * family are fetched when the family is first needed, registered with the
 * browser under the application's own CSS name and kept for PDF export — so
 * what is drawn, measured and embedded is always the same file.
 */

interface FontState {
  families: SystemFontFamily[];
  /** Changes whenever a family finishes loading, so text is laid out again. */
  version: number;
}

export const useFontStore = create<FontState>(() => ({ families: [], version: 0 }));

type Style = 'regular' | 'bold' | 'italic' | 'boldItalic';
const styleOf = ({ bold, italic }: FontVariant): Style => (bold ? (italic ? 'boldItalic' : 'bold') : italic ? 'italic' : 'regular');
const variantOf: Record<Style, FontVariant> = {
  regular: { bold: false, italic: false },
  bold: { bold: true, italic: false },
  italic: { bold: false, italic: true },
  boldItalic: { bold: true, italic: true },
};
/** Which style stands in for a missing one, best first. Nothing is ever faked by slanting or thickening. */
const SUBSTITUTES: Record<Style, Style[]> = {
  regular: ['regular', 'italic', 'bold', 'boldItalic'],
  bold: ['bold', 'regular', 'boldItalic', 'italic'],
  italic: ['italic', 'regular', 'boldItalic', 'bold'],
  boldItalic: ['boldItalic', 'bold', 'italic', 'regular'],
};

const catalogue = new Map<string, SystemFontFamily>();
const faces = new Map<string, Uint8Array>();
const loading = new Map<string, Promise<boolean>>();
const loaded = new Set<string>();
const faceKey = (family: string, style: Style): string => `${family}\n${style}`;

/** Fetches the list of installed families. Failure just leaves the bundled fonts. */
export async function initFonts(): Promise<void> {
  const families = await window.api.fonts.list().catch(() => []);
  catalogue.clear();
  for (const family of families) {
    catalogue.set(family.family, family);
    setFontAscent(family.family, family.ascent);
  }
  useFontStore.setState({ families });
}

export const isFontInstalled = (family: FontFamily): boolean => isBuiltInFont(family) || catalogue.has(family);
export const isFontReady = (family: FontFamily): boolean => isBuiltInFont(family) || loaded.has(family) || !catalogue.has(family);

/**
 * The style actually used for a request: families without a bold or italic
 * face use the closest one they have, on screen and in the PDF alike.
 */
export function effectiveVariant(family: FontFamily, variant: FontVariant): FontVariant {
  const entry = isBuiltInFont(family) ? undefined : catalogue.get(family);
  if (!entry) return variant;
  const style = SUBSTITUTES[styleOf(variant)].find((candidate) => entry[candidate]);
  return style ? variantOf[style] : variant;
}

/** Loads every style of a family. Resolves to false when the family is not installed or cannot be read. */
export function ensureFontLoaded(family: FontFamily): Promise<boolean> {
  if (isBuiltInFont(family)) return Promise.resolve(true);
  const entry = catalogue.get(family);
  if (!entry) return Promise.resolve(false);
  let pending = loading.get(family);
  if (!pending) {
    pending = (async () => {
      const styles = (Object.keys(variantOf) as Style[]).filter((style) => entry[style]);
      const results = await Promise.all(
        styles.map(async (style) => {
          const bytes = await window.api.fonts.read({ family, ...variantOf[style] }).catch(() => null);
          if (!bytes) return false;
          faces.set(faceKey(family, style), bytes);
          if (typeof FontFace !== 'undefined') {
            const { bold, italic } = variantOf[style];
            const face = new FontFace(systemCssFamily(family), bytes.slice().buffer, {
              weight: bold ? '700' : '400',
              style: italic ? 'italic' : 'normal',
            });
            // A file the browser refuses is not used anywhere, so screen and PDF cannot differ.
            try {
              document.fonts.add(await face.load());
            } catch {
              faces.delete(faceKey(family, style));
              return false;
            }
          }
          return true;
        }),
      );
      const ok = results.some(Boolean);
      if (ok) loaded.add(family);
      else catalogue.delete(family);
      useFontStore.setState((state) => ({ version: state.version + 1 }));
      return ok;
    })();
    loading.set(family, pending);
  }
  return pending;
}

/** Font file to embed for a text style, or `null` when the family is not available here. */
export async function getFaceBytes(family: FontFamily, variant: FontVariant): Promise<Uint8Array | null> {
  if (isBuiltInFont(family) || !(await ensureFontLoaded(family))) return null;
  return faces.get(faceKey(family, styleOf(effectiveVariant(family, variant)))) ?? null;
}

/** Test hook: forgets everything that was loaded. */
export function resetFonts(): void {
  catalogue.clear();
  faces.clear();
  loading.clear();
  loaded.clear();
  useFontStore.setState({ families: [], version: 0 });
}
