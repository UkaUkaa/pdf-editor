import { create } from 'zustand';
import type { PasswordReason } from '../engine/pdf/types';

export type DialogId = 'settings' | 'about' | 'split' | 'watermark' | 'headerFooter' | 'ocr' | 'exportImages' | 'protect' | 'updates';

export interface Notice {
  /** Translation key of the dialog title. */
  titleKey: string;
  /** Already translated lines, one per item. */
  lines: string[];
}

export interface PasswordRequest {
  fileName: string;
  reason: PasswordReason;
  resolve: (password: string | null) => void;
}

export type ConfirmAnswer = 'confirm' | 'alternative' | 'cancel';

export interface ConfirmOptions {
  /** Already translated texts. */
  title: string;
  message: string;
  confirmLabel: string;
  /** Optional second action, e.g. "Don't save". */
  alternativeLabel?: string;
  /** Marks the confirm action as destructive. */
  danger?: boolean;
}

export interface ConfirmRequest extends ConfirmOptions {
  resolve: (answer: ConfirmAnswer) => void;
}

interface UiState {
  dialog: DialogId | null;
  notice: Notice | null;
  passwordRequest: PasswordRequest | null;
  confirmRequest: ConfirmRequest | null;
  /** Number of long-running operations in progress (shown in the status bar). */
  busy: number;
  /** True while a text field has focus; edit commands then act on the field, not the document. */
  textFieldFocused: boolean;
  /** Layer whose name is being edited in the layers panel. */
  renamingLayerId: string | null;
  setRenamingLayer: (layerId: string | null) => void;
  /** Bookmark selected in the bookmarks panel, and whether its title is being edited. */
  selectedBookmarkId: string | null;
  renamingBookmark: boolean;
  setBookmarkFocus: (id: string | null, renaming: boolean) => void;
  /** Note whose text field should take the keyboard focus in the comments panel. */
  focusNoteId: string | null;
  setNoteFocus: (id: string | null) => void;
  /** Login name of the operating-system user (default author of comments). */
  systemUserName: string;
  openDialog: (dialog: DialogId) => void;
  closeDialog: () => void;
  showNotice: (notice: Notice) => void;
  dismissNotice: () => void;
  requestPassword: (fileName: string, reason: PasswordReason) => Promise<string | null>;
  answerPassword: (password: string | null) => void;
  confirm: (options: ConfirmOptions) => Promise<ConfirmAnswer>;
  answerConfirm: (answer: ConfirmAnswer) => void;
  beginBusy: () => void;
  endBusy: () => void;
  setTextFieldFocused: (focused: boolean) => void;
}

/** Transient interface state that is not persisted between sessions. */
export const useUiStore = create<UiState>((set, get) => ({
  dialog: null,
  notice: null,
  passwordRequest: null,
  confirmRequest: null,
  busy: 0,
  textFieldFocused: false,
  renamingLayerId: null,
  setRenamingLayer: (renamingLayerId) => set({ renamingLayerId }),
  selectedBookmarkId: null,
  renamingBookmark: false,
  setBookmarkFocus: (selectedBookmarkId, renamingBookmark) => set({ selectedBookmarkId, renamingBookmark }),
  focusNoteId: null,
  setNoteFocus: (focusNoteId) => set({ focusNoteId }),
  systemUserName: '',
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
  showNotice: (notice) => set({ notice }),
  dismissNotice: () => set({ notice: null }),
  requestPassword: (fileName, reason) =>
    new Promise((resolve) => {
      // A pending request can only be superseded by cancelling it.
      get().passwordRequest?.resolve(null);
      set({ passwordRequest: { fileName, reason, resolve } });
    }),
  answerPassword: (password) => {
    const request = get().passwordRequest;
    set({ passwordRequest: null });
    request?.resolve(password);
  },
  confirm: (options) =>
    new Promise((resolve) => {
      get().confirmRequest?.resolve('cancel');
      set({ confirmRequest: { ...options, resolve } });
    }),
  answerConfirm: (answer) => {
    const request = get().confirmRequest;
    set({ confirmRequest: null });
    request?.resolve(answer);
  },
  beginBusy: () => set((state) => ({ busy: state.busy + 1 })),
  endBusy: () => set((state) => ({ busy: Math.max(0, state.busy - 1) })),
  setTextFieldFocused: (textFieldFocused) => set({ textFieldFocused }),
}));

export function resetUiStore(): void {
  useUiStore.setState({
    dialog: null,
    notice: null,
    passwordRequest: null,
    confirmRequest: null,
    busy: 0,
    textFieldFocused: false,
    renamingLayerId: null,
    selectedBookmarkId: null,
    renamingBookmark: false,
    focusNoteId: null,
  });
}
