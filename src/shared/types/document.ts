/** Types shared by the main process (file access) and the renderer (document model). */
import type { PageLayers } from './layers';
import type { PageObjects } from './objects';

export const OPEN_FILE_ERRORS = ['notFound', 'notPdf', 'notImage', 'tooLarge', 'unreadable'] as const;
export type OpenFileError = (typeof OPEN_FILE_ERRORS)[number];

/** Files larger than this are refused until range-based loading is implemented. */
export const MAX_PDF_FILE_SIZE = 1024 * 1024 * 1024;

/** Project archives hold the source PDFs plus images and attachments, so they may be larger. */
export const MAX_PROJECT_FILE_SIZE = 2 * 1024 * 1024 * 1024 - 1;

/** The two kinds of file a document can be saved to. */
export type DocumentFileKind = 'pdf' | 'project';
export const PROJECT_FILE_EXTENSION = '.pdfproject';
export const documentFileKind = (pathOrName: string | null): DocumentFileKind =>
  pathOrName?.toLowerCase().endsWith(PROJECT_FILE_EXTENSION) ? 'project' : 'pdf';

/** A document kept in the recovery folder because it had unsaved changes. */
export interface RecoveryEntry {
  id: string;
  name: string;
  /** File the document belongs to; `null` when it was never saved. */
  path: string | null;
  /** Milliseconds since the Unix epoch. */
  savedAt: number;
  size: number;
}

export const MAX_RECENT_FILES = 12;
/** Upper bound for one open request, protecting the main process from absurd payloads. */
export const MAX_PATHS_PER_REQUEST = 64;

export interface OpenedFile {
  path: string;
  name: string;
  size: number;
  data: Uint8Array;
}

export type OpenFileResult =
  | { ok: true; file: OpenedFile }
  | { ok: false; path: string; name: string; error: OpenFileError };

export interface RecentFile {
  path: string;
  name: string;
  /** Milliseconds since the Unix epoch. */
  openedAt: number;
}

export type PageRotation = 0 | 90 | 180 | 270;

/** Rectangle in PDF user space (points, origin at the bottom-left, y pointing up). */
export interface PdfBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where the content of a page comes from. The source files themselves are never modified. */
export type PageSource =
  | { kind: 'pdf'; sourceId: string; pageIndex: number }
  | { kind: 'image'; assetId: string }
  | { kind: 'blank' };

export interface PageModel {
  id: string;
  source: PageSource;
  /** Visible page box (CropBox) in PDF user space, before rotation. */
  box: PdfBox;
  rotation: PageRotation;
}

/** Raster formats that can be imported as pages. */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] as const;
export const MAX_IMAGE_FILE_SIZE = 256 * 1024 * 1024;

/** ISO A4 in points; the default size of new blank pages. */
export const A4_SIZE = { width: 595.28, height: 841.89 } as const;

export const VIEW_MODES = ['single', 'continuous', 'twoPage'] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

export type ZoomMode = 'fitPage' | 'fitWidth' | 'custom';

export interface ViewState {
  viewMode: ViewMode;
  zoomMode: ZoomMode;
  /** Zoom factor used when `zoomMode` is `custom`; 1 means 100 % (actual size). */
  customScale: number;
  /** Zero-based index of the current page. */
  currentPage: number;
  /** Zoom factor actually in effect, reported by the viewer (fit modes depend on the window size). */
  effectiveZoom: number;
  /** Incremented by explicit navigation so the viewer scrolls to `currentPage`. */
  navigationSeq: number;
}

/** An entry of the document outline. */
export interface Bookmark {
  id: string;
  title: string;
  /** Page the bookmark jumps to; `null` when it has no target (or its page was deleted). */
  pageId: string | null;
  children: Bookmark[];
}

/**
 * A line of text recognised by OCR, in page space (points, origin top-left, y down).
 * Same shape as the text lines read from a PDF, so search treats both alike.
 */
export interface RecognisedLine {
  text: string;
  x: number;
  baseline: number;
  /** Direction of the text, degrees clockwise; 0 is ordinary left-to-right text. */
  angle: number;
  width: number;
  fontSize: number;
  fontFamily: 'sans' | 'serif' | 'mono';
}

/** Recognised text of every page that went through OCR, keyed by page id. */
export type RecognisedText = Record<string, RecognisedLine[]>;

/** A file embedded in the document. Its bytes are kept outside the model, under `resourceId`. */
export interface Attachment {
  id: string;
  name: string;
  size: number;
  resourceId: string;
}

/**
 * Password protection applied when the document is written as a PDF. One
 * password both opens the file and gives full rights. It lives in memory only:
 * it is never stored in settings, project files or recovery copies.
 */
export interface DocumentProtection {
  password: string;
}

/** One undoable state of the document structure. */
export interface HistoryEntry {
  pages: PageModel[];
  objects: PageObjects;
  layers: PageLayers;
  bookmarks: Bookmark[];
  attachments: Attachment[];
  recognised: RecognisedText;
  selection: string[];
}

export interface DocumentHistory {
  past: HistoryEntry[];
  future: HistoryEntry[];
}

export const MAX_HISTORY_DEPTH = 100;

export interface DocumentModel {
  id: string;
  name: string;
  /** File the document is saved to; `null` for documents that were never saved. */
  path: string | null;
  pages: PageModel[];
  /** Ids of the pages selected in the thumbnail panel. */
  selection: string[];
  /** Editable objects on top of the pages, keyed by page id. */
  objects: PageObjects;
  /** Layer stack of every page that has one, keyed by page id (bottom to top). */
  layers: PageLayers;
  /** Document outline. */
  bookmarks: Bookmark[];
  /** Files embedded in the document. */
  attachments: Attachment[];
  /** Password protection of the saved PDF; `null` when the file is not protected. */
  protection: DocumentProtection | null;
  savedProtection: DocumentProtection | null;
  /** Text recognised by OCR; written to the PDF as an invisible, searchable layer. */
  recognised: RecognisedText;
  /** The layer the user is working on, per page; new objects go there. */
  activeLayers: Record<string, string>;
  /** Ids of the selected objects (always on the current page). */
  selectedObjects: string[];
  /** State as of the last save; the document is modified when either differs from the current one. */
  savedPages: PageModel[];
  savedObjects: PageObjects;
  savedLayers: PageLayers;
  savedBookmarks: Bookmark[];
  savedAttachments: Attachment[];
  savedRecognised: RecognisedText;
  modified: boolean;
  history: DocumentHistory;
  /** PDF sources and image assets owned by this document, released when it closes. */
  resourceIds: string[];
  view: ViewState;
}

export type WriteFileResult =
  | { ok: true; path: string; size: number }
  | { ok: false; error: 'notAllowed' | 'invalid' | 'writeFailed' };

export const DEFAULT_VIEW_STATE: ViewState = {
  viewMode: 'continuous',
  zoomMode: 'fitWidth',
  customScale: 1,
  currentPage: 0,
  effectiveZoom: 1,
  navigationSeq: 0,
};
