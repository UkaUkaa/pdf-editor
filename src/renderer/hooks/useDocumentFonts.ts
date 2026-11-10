import { useEffect } from 'react';
import { isBuiltInFont } from '@shared/fonts';
import type { PageObjects } from '@shared/types/objects';
import { ensureFontLoaded, initFonts, useFontStore } from '../engine/fonts/fontRegistry';
import { useDocumentsStore } from '../stores/documentsStore';

/**
 * Loads the installed fonts that open documents use (a project opened from a
 * file, an undo that brings a font back, pasted text). Text shows in the
 * bundled fallback font for the moment it takes and is then laid out again.
 */
export function useDocumentFonts(): void {
  // The list of installed fonts normally arrives before the first render; this covers the rest.
  const known = useFontStore((state) => state.families.length);

  useEffect(() => {
    if (known === 0) void initFonts();
  }, [known]);

  useEffect(() => {
    // Each state of a document's objects is looked through once.
    const seen = new WeakSet<PageObjects>();
    const load = (): void => {
      for (const document of useDocumentsStore.getState().documents) {
        if (seen.has(document.objects)) continue;
        seen.add(document.objects);
        for (const objects of Object.values(document.objects)) {
          for (const object of objects) {
            if (object.type === 'text' && !isBuiltInFont(object.fontFamily)) void ensureFontLoaded(object.fontFamily);
          }
        }
      }
    };
    load();
    return useDocumentsStore.subscribe(load);
  }, [known]);
}
