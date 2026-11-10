import type { DocumentModel } from '@shared/types/document';
import { DEFAULT_NOTE_COLOR, NOTE_SIZE, type LinkObject, type LinkTarget, type NoteObject } from '@shared/types/objects';
import { safeExternalUrl } from '@shared/utils/externalUrl';
import type { Point } from '../../engine/coordinates/pageCoordinates';
import { UNASSIGNED_LAYER } from '../../engine/objects/factory';
import type { Box } from '../../engine/objects/geometry';
import { i18n } from '../../localization/i18n';
import { getActiveDocument, getDocument } from '../../stores/documentsStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUiStore } from '../../stores/uiStore';
import { goToPage } from '../documents/documentActions';
import { activateTool, addObject, objectsOnPage, replaceObjects, selectObjects } from '../pdf-editor/objectActions';

const newId = (): string => crypto.randomUUID();

/** Name put on new comments: the one from the settings, else the operating-system user name. */
export function authorName(): string {
  return useSettingsStore.getState().settings.authorName.trim() || useUiStore.getState().systemUserName || i18n.t('comments.anonymous');
}

/** Places a note with its top-left corner at `point` and opens the comments panel to type its text. */
export function createNote(documentId: string, pageId: string, point: Point): void {
  const note: NoteObject = {
    id: newId(),
    layerId: UNASSIGNED_LAYER,
    type: 'note',
    x: point.x,
    y: point.y,
    width: NOTE_SIZE,
    height: NOTE_SIZE,
    rotation: 0,
    opacity: 1,
    text: '',
    author: authorName(),
    createdAt: new Date().toISOString(),
    replies: [],
    color: DEFAULT_NOTE_COLOR,
  };
  addObject(documentId, pageId, note);
  activateTool('select');
  useSettingsStore.getState().update({ layout: { leftCollapsed: false, leftTab: 'comments' } });
  useUiStore.getState().setNoteFocus(note.id);
}

export interface NoteEntry {
  note: NoteObject;
  pageId: string;
  pageNumber: number;
}

/** Every note of the document in reading order: by page, then top to bottom. */
export function notesOf(document: DocumentModel): NoteEntry[] {
  return document.pages.flatMap((page, index) =>
    objectsOnPage(document, page.id)
      .filter((object): object is NoteObject => object.type === 'note')
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((note) => ({ note, pageId: page.id, pageNumber: index + 1 })),
  );
}

function changeNote(documentId: string, pageId: string, noteId: string, change: (note: NoteObject) => NoteObject, key?: string): void {
  const document = getDocument(documentId);
  const note = document && objectsOnPage(document, pageId).find((object) => object.id === noteId);
  if (note?.type === 'note') replaceObjects(documentId, pageId, [change(note)], key);
}

export function setNoteText(documentId: string, pageId: string, noteId: string, text: string): void {
  changeNote(documentId, pageId, noteId, (note) => (note.text === text ? note : { ...note, text }));
}

export function addReply(documentId: string, pageId: string, noteId: string, text: string): void {
  const trimmed = text.trim();
  if (trimmed === '') return;
  changeNote(documentId, pageId, noteId, (note) => ({
    ...note,
    replies: [...note.replies, { id: newId(), text: trimmed, author: authorName(), createdAt: new Date().toISOString() }],
  }));
}

export function deleteReply(documentId: string, pageId: string, noteId: string, replyId: string): void {
  changeNote(documentId, pageId, noteId, (note) => ({ ...note, replies: note.replies.filter((reply) => reply.id !== replyId) }));
}

/** Shows the page of a note and selects the note on it. */
export function revealNote(documentId: string, entry: NoteEntry): void {
  goToPage(entry.pageNumber - 1, documentId);
  activateTool('select');
  selectObjects(documentId, [entry.note.id]);
}

// --- Links ---------------------------------------------------------------------------------

export function createLink(documentId: string, pageId: string, box: Box): void {
  const link: LinkObject = {
    id: newId(),
    layerId: UNASSIGNED_LAYER,
    type: 'link',
    ...box,
    rotation: 0,
    opacity: 1,
    target: { kind: 'url', url: '' },
  };
  addObject(documentId, pageId, link);
  activateTool('select');
}

/** Describes where a link leads, for display. */
export function describeTarget(document: DocumentModel, target: LinkTarget): string {
  if (target.kind === 'url') return target.url || i18n.t('links.noTarget');
  const index = document.pages.findIndex((page) => page.id === target.pageId);
  return index === -1 ? i18n.t('links.noTarget') : i18n.t('viewer.pageLabel', { number: index + 1 });
}

/**
 * Follows a link. Pages are shown directly; web and mail addresses are opened
 * outside the application only after the user has seen the address and agreed.
 */
export async function followLink(link: LinkObject): Promise<void> {
  const document = getActiveDocument();
  if (!document) return;
  if (link.target.kind === 'page') {
    const index = document.pages.findIndex((page) => page.id === (link.target as { pageId: string }).pageId);
    if (index !== -1) goToPage(index, document.id);
    return;
  }
  const url = safeExternalUrl(link.target.url);
  if (!url) return;
  const answer = await useUiStore.getState().confirm({
    title: i18n.t('links.openTitle'),
    message: i18n.t('links.openMessage', { url }),
    confirmLabel: i18n.t('links.open'),
  });
  if (answer === 'confirm') await window.api.app.openExternal(url);
}
