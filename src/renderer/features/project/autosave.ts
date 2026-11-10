import { useEffect } from 'react';
import type { DocumentModel } from '@shared/types/document';
import { getDocument, useDocumentsStore } from '../../stores/documentsStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { serialiseDocument } from './projectActions';

/**
 * Autosave never touches the user's own files. It writes a project archive of
 * every document with unsaved changes into the application's recovery folder;
 * the copy disappears as soon as the document is saved or closed, and is
 * offered for recovery if the application dies before that.
 */

/** State of each document as of its last recovery copy. */
const copies = new Map<string, DocumentModel>();
let running = false;

const sameContent = (a: DocumentModel, b: DocumentModel): boolean =>
  a.pages === b.pages &&
  a.objects === b.objects &&
  a.layers === b.layers &&
  a.bookmarks === b.bookmarks &&
  a.attachments === b.attachments &&
  a.recognised === b.recognised &&
  a.name === b.name &&
  a.path === b.path;

/** Records that a recovery copy of this exact state already exists (written by the recovery itself). */
export function noteRecoveryCopy(document: DocumentModel): void {
  copies.set(document.id, document);
}

/** Removes the copies of documents that no longer need one: saved, unchanged again, or closed. */
async function dropUnneeded(): Promise<void> {
  for (const id of [...copies.keys()]) {
    const document = getDocument(id);
    if (document?.modified) continue;
    copies.delete(id);
    await window.api.recovery.remove(id).catch(() => undefined);
  }
}

/** Writes a recovery copy of every modified document that changed since its last copy. */
export async function autosaveNow(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (const document of useDocumentsStore.getState().documents) {
      const last = copies.get(document.id);
      if (!document.modified || (last && sameContent(last, document))) continue;
      try {
        const data = await serialiseDocument(document);
        const { id, name, path } = document;
        if (await window.api.recovery.write({ id, name, path }, data)) copies.set(id, document);
      } catch (error) {
        // Autosave must never get in the user's way; the next round tries again.
        console.warn('Autosave failed', error);
      }
    }
    await dropUnneeded();
  } finally {
    running = false;
  }
}

/** Test hook: forgets all bookkeeping. */
export function resetAutosave(): void {
  copies.clear();
  running = false;
}

/** Runs autosave at the interval chosen in the preferences (0 turns it off). */
export function useAutosave(): void {
  const interval = useSettingsStore((state) => state.settings.autosaveInterval);

  useEffect(() => {
    if (interval <= 0) return undefined;
    const timer = window.setInterval(() => void autosaveNow(), interval * 1000);
    return () => window.clearInterval(timer);
  }, [interval]);

  // Copies of saved and closed documents go away at once, not at the next round.
  useEffect(
    () =>
      useDocumentsStore.subscribe(() => {
        if (copies.size > 0 && !running) void dropUnneeded();
      }),
    [],
  );
}
