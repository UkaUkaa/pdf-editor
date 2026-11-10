import { create } from 'zustand';
import {
  MAX_HISTORY_DEPTH,
  type Attachment,
  type Bookmark,
  type DocumentModel,
  type HistoryEntry,
  type PageModel,
  type RecognisedText,
  type ViewState,
  type DocumentProtection,
} from '@shared/types/document';
import type { PageLayers } from '@shared/types/layers';
import type { PageObjects } from '@shared/types/objects';

interface SavedInfo {
  path: string;
  name: string;
}

export interface CommitOptions {
  pages?: PageModel[];
  objects?: PageObjects;
  layers?: PageLayers;
  bookmarks?: Bookmark[];
  attachments?: Attachment[];
  recognised?: RecognisedText;
  /** Page selection after the change; defaults to the current one reduced to existing pages. */
  selection?: string[];
  selectedObjects?: string[];
  /**
   * Consecutive commits with the same key (e.g. dragging a slider, typing a
   * number, nudging with the arrow keys) are merged into one undo step.
   */
  coalesceKey?: string;
}

interface DocumentsState {
  documents: DocumentModel[];
  activeId: string | null;
  add: (document: DocumentModel) => void;
  /** Removes the document from the state. Resources are released by `closeDocument`. */
  remove: (id: string) => void;
  setActive: (id: string) => void;
  updateView: (id: string, patch: Partial<ViewState>) => void;
  /** Applies a change to pages and/or objects as one undoable step. */
  commit: (id: string, change: CommitOptions) => void;
  setSelection: (id: string, selection: string[]) => void;
  setSelectedObjects: (id: string, ids: string[]) => void;
  setActiveLayer: (id: string, pageId: string, layerId: string) => void;
  undo: (id: string) => void;
  redo: (id: string) => void;
  /** Records that the current state is what is stored on disk. */
  markSaved: (id: string, saved?: SavedInfo) => void;
  /** Sets or removes the password the saved PDF is protected with. Not part of the undo history. */
  setProtection: (id: string, protection: DocumentProtection | null) => void;
  addResources: (id: string, resourceIds: string[]) => void;
}

type Updater = (document: DocumentModel) => DocumentModel;

const COALESCE_WINDOW_MS = 1200;
/** Last commit per document, for merging rapid edits of the same property. Not part of the state. */
const lastCommits = new Map<string, { key: string; time: number }>();

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

const isModified = (
  document: Pick<
    DocumentModel,
    | 'pages'
    | 'objects'
    | 'layers'
    | 'bookmarks'
    | 'attachments'
    | 'recognised'
    | 'savedRecognised'
    | 'savedPages'
    | 'savedObjects'
    | 'savedLayers'
    | 'savedBookmarks'
    | 'savedAttachments'
    | 'protection'
    | 'savedProtection'
  >,
): boolean =>
  (document.protection?.password ?? null) !== (document.savedProtection?.password ?? null) ||
  document.recognised !== document.savedRecognised ||
  document.attachments !== document.savedAttachments ||
  document.bookmarks !== document.savedBookmarks ||
  document.pages !== document.savedPages ||
  document.objects !== document.savedObjects ||
  document.layers !== document.savedLayers;

/** Keeps the same page current across a structural change where possible. */
function relocateView(document: DocumentModel, pages: PageModel[], preferredPageId?: string): ViewState {
  if (pages === document.pages && preferredPageId === undefined) return document.view;
  const wantedId = preferredPageId ?? document.pages[document.view.currentPage]?.id;
  const found = pages.findIndex((page) => page.id === wantedId);
  const currentPage = found !== -1 ? found : Math.max(0, Math.min(document.view.currentPage, pages.length - 1));
  return { ...document.view, currentPage, navigationSeq: document.view.navigationSeq + 1 };
}

const snapshot = (document: DocumentModel): HistoryEntry => ({
  pages: document.pages,
  objects: document.objects,
  layers: document.layers,
  bookmarks: document.bookmarks,
  attachments: document.attachments,
  recognised: document.recognised,
  selection: document.selection,
});

function restore(document: DocumentModel, entry: HistoryEntry, history: DocumentModel['history']): DocumentModel {
  const pagesChanged = entry.pages !== document.pages;
  const next = {
    ...document,
    pages: entry.pages,
    objects: entry.objects,
    layers: entry.layers,
    bookmarks: entry.bookmarks,
    attachments: entry.attachments,
    recognised: entry.recognised,
  };
  // Objects that still exist after the step stay selected, so the user can keep working on them.
  const existing = new Set(Object.values(entry.objects).flatMap((list) => list.map((object) => object.id)));
  return {
    ...next,
    selection: entry.selection,
    selectedObjects: pagesChanged ? [] : document.selectedObjects.filter((id) => existing.has(id)),
    modified: isModified(next),
    history,
    view: pagesChanged ? relocateView(document, entry.pages, entry.selection[0]) : document.view,
  };
}

/** Open documents. Each one carries its own view state, selection and undo history. */
export const useDocumentsStore = create<DocumentsState>((set) => {
  const update = (id: string, updater: Updater): void =>
    set((state) => {
      let changed = false;
      const documents = state.documents.map((document) => {
        if (document.id !== id) return document;
        const next = updater(document);
        if (next !== document) changed = true;
        return next;
      });
      return changed ? { documents } : state;
    });

  return {
    documents: [],
    activeId: null,
    add: (document) => set((state) => ({ documents: [...state.documents, document], activeId: document.id })),
    remove: (id) =>
      set((state) => {
        const index = state.documents.findIndex((document) => document.id === id);
        if (index === -1) return state;
        lastCommits.delete(id);
        const documents = state.documents.filter((document) => document.id !== id);
        // Closing the active tab activates its right neighbour, or the new last tab.
        const activeId =
          state.activeId === id ? (documents[Math.min(index, documents.length - 1)]?.id ?? null) : state.activeId;
        return { documents, activeId };
      }),
    setActive: (id) => set((state) => (state.documents.some((document) => document.id === id) ? { activeId: id } : state)),
    updateView: (id, patch) =>
      update(id, (document) => {
        const changed = (Object.keys(patch) as Array<keyof ViewState>).some((key) => document.view[key] !== patch[key]);
        if (!changed) return document;
        const view = { ...document.view, ...patch };
        // Commands act on the selection, so it must never silently stay behind: when the
        // current page moves outside the selected pages, the selection is dropped.
        const currentId = document.pages[view.currentPage]?.id;
        const stale =
          patch.currentPage !== undefined &&
          document.selection.length > 0 &&
          (currentId === undefined || !document.selection.includes(currentId));
        // Selected objects always belong to the current page.
        const pageChanged = patch.currentPage !== undefined && patch.currentPage !== document.view.currentPage;
        return {
          ...document,
          view,
          selection: stale ? [] : document.selection,
          selectedObjects: pageChanged && document.selectedObjects.length > 0 ? [] : document.selectedObjects,
        };
      }),
    commit: (id, change) =>
      update(id, (document) => {
        const pages = change.pages ?? document.pages;
        const objects = change.objects ?? document.objects;
        const layers = change.layers ?? document.layers;
        const bookmarks = change.bookmarks ?? document.bookmarks;
        const attachments = change.attachments ?? document.attachments;
        const recognised = change.recognised ?? document.recognised;
        if (
          recognised === document.recognised &&
          attachments === document.attachments &&
          pages === document.pages &&
          objects === document.objects &&
          layers === document.layers &&
          bookmarks === document.bookmarks
        ) {
          return document;
        }

        const pageIds = new Set(pages.map((page) => page.id));
        const selection = (change.selection ?? document.selection).filter((pageId) => pageIds.has(pageId));

        const now = Date.now();
        const previous = lastCommits.get(id);
        const coalesce =
          change.coalesceKey !== undefined &&
          previous?.key === change.coalesceKey &&
          now - previous.time < COALESCE_WINDOW_MS &&
          document.history.past.length > 0;
        if (change.coalesceKey) lastCommits.set(id, { key: change.coalesceKey, time: now });
        else lastCommits.delete(id);

        // When coalescing, the entry already on the stack is the state to return to.
        const past = coalesce ? document.history.past : [...document.history.past, snapshot(document)];
        const next = { ...document, pages, objects, layers, bookmarks, attachments, recognised };
        return {
          ...next,
          selection,
          selectedObjects: change.selectedObjects ?? document.selectedObjects,
          modified: isModified(next),
          // A new change invalidates everything that was undone before it.
          history: { past: past.slice(-MAX_HISTORY_DEPTH), future: [] },
          view: relocateView(document, pages, change.pages ? change.selection?.[0] : undefined),
        };
      }),
    setSelection: (id, selection) =>
      update(id, (document) => (sameList(selection, document.selection) ? document : { ...document, selection })),
    setSelectedObjects: (id, ids) =>
      update(id, (document) => (sameList(ids, document.selectedObjects) ? document : { ...document, selectedObjects: ids })),
    setActiveLayer: (id, pageId, layerId) =>
      update(id, (document) =>
        document.activeLayers[pageId] === layerId
          ? document
          : { ...document, activeLayers: { ...document.activeLayers, [pageId]: layerId } },
      ),
    undo: (id) =>
      update(id, (document) => {
        const entry = document.history.past.at(-1);
        if (!entry) return document;
        lastCommits.delete(id);
        return restore(document, entry, {
          past: document.history.past.slice(0, -1),
          future: [...document.history.future, snapshot(document)],
        });
      }),
    redo: (id) =>
      update(id, (document) => {
        const entry = document.history.future.at(-1);
        if (!entry) return document;
        lastCommits.delete(id);
        return restore(document, entry, {
          past: [...document.history.past, snapshot(document)],
          future: document.history.future.slice(0, -1),
        });
      }),
    markSaved: (id, saved) =>
      update(id, (document) => ({
        ...document,
        ...(saved ?? {}),
        savedPages: document.pages,
        savedObjects: document.objects,
        savedLayers: document.layers,
        savedBookmarks: document.bookmarks,
        savedAttachments: document.attachments,
        savedRecognised: document.recognised,
        savedProtection: document.protection,
        modified: false,
      })),
    setProtection: (id, protection) =>
      update(id, (document) => {
        const next = { ...document, protection };
        return { ...next, modified: isModified(next) };
      }),
    addResources: (id, resourceIds) =>
      update(id, (document) => ({ ...document, resourceIds: [...document.resourceIds, ...resourceIds] })),
  };
});

export function selectActiveDocument(state: DocumentsState): DocumentModel | null {
  return state.documents.find((document) => document.id === state.activeId) ?? null;
}

export function getActiveDocument(): DocumentModel | null {
  return selectActiveDocument(useDocumentsStore.getState());
}

export function getDocument(id: string): DocumentModel | null {
  return useDocumentsStore.getState().documents.find((document) => document.id === id) ?? null;
}
