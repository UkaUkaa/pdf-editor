import { create } from 'zustand';
import { ProjectError } from '@shared/schemas/project';
import type { RecoveryEntry } from '@shared/types/document';
import { PdfLoadError } from '../../engine/pdf/types';
import { i18n } from '../../localization/i18n';
import { useDocumentsStore } from '../../stores/documentsStore';
import { useUiStore } from '../../stores/uiStore';
import { createDocument } from '../documents/documentFactory';
import { noteRecoveryCopy } from './autosave';
import { loadProject } from './projectActions';

interface RecoveryState {
  /** Recovery copies left by a session that did not end cleanly. */
  entries: RecoveryEntry[];
  /** Whether the user is being asked what to do with them. */
  open: boolean;
}

export const useRecoveryStore = create<RecoveryState>(() => ({ entries: [], open: false }));

const forget = (id: string): void =>
  useRecoveryStore.setState((state) => {
    const entries = state.entries.filter((entry) => entry.id !== id);
    return { entries, open: state.open && entries.length > 0 };
  });

/** Looks for documents to recover; called once when the application starts. */
export async function checkRecovery(): Promise<void> {
  const entries = await window.api.recovery.list().catch(() => []);
  useRecoveryStore.setState({ entries, open: entries.length > 0 });
}

export function postponeRecovery(): void {
  // The copies stay on disk and are offered again at the next start.
  useRecoveryStore.setState({ open: false });
}

/**
 * Opens a recovery copy as a document with unsaved changes, belonging to the
 * same file as before. The old copy is removed only after the restored
 * document has a copy of its own, so a second crash loses nothing either.
 */
export async function restoreEntry(entry: RecoveryEntry): Promise<boolean> {
  const ui = useUiStore.getState();
  const fail = (reason: string): boolean => {
    ui.showNotice({ titleKey: 'recovery.failedTitle', lines: [`${entry.name}: ${reason}`] });
    return false;
  };
  ui.beginBusy();
  try {
    const data = await window.api.recovery.read(entry.id);
    if (!data) return fail(i18n.t('recovery.unreadable'));
    // The loader may take ownership of buffers; the bytes are needed again below.
    const project = await loadProject(data.slice(), entry.name);
    const document = createDocument(entry.name, entry.path, project.pages, project.resourceIds, false, { ...project.content, protection: project.protection });
    useDocumentsStore.getState().add(document);
    if (await window.api.recovery.write({ id: document.id, name: document.name, path: document.path }, data)) {
      noteRecoveryCopy(document);
    }
    await window.api.recovery.remove(entry.id);
    forget(entry.id);
    return true;
  } catch (error) {
    if (error instanceof PdfLoadError && error.code === 'cancelled') return false;
    if (error instanceof PdfLoadError || error instanceof ProjectError) return fail(i18n.t(`errors.open.${error.code}`));
    console.error(error);
    return fail(i18n.t('errors.open.unknown'));
  } finally {
    ui.endBusy();
  }
}

export async function restoreAll(): Promise<void> {
  for (const entry of useRecoveryStore.getState().entries) await restoreEntry(entry);
}

/** Deletes recovery copies for good, after an explicit confirmation. */
export async function discardEntries(entries: RecoveryEntry[]): Promise<boolean> {
  const answer = await useUiStore.getState().confirm({
    title: i18n.t('recovery.discardConfirmTitle'),
    message: i18n.t('recovery.discardConfirm'),
    confirmLabel: i18n.t('recovery.discard'),
    danger: true,
  });
  if (answer !== 'confirm') return false;
  for (const entry of entries) {
    await window.api.recovery.remove(entry.id).catch(() => undefined);
    forget(entry.id);
  }
  return true;
}
