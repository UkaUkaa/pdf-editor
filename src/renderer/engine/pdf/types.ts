import type { PageRotation, PdfBox } from '@shared/types/document';
import type { OutlineNode } from '../bookmarks/bookmarkOperations';
import type { SourceAnnotation, SourceAttachment } from './sourceTypes';

export type { SourceAnnotation, SourceAttachment } from './sourceTypes';

export interface SourcePageInfo {
  box: PdfBox;
  rotation: PageRotation;
}

export interface RenderRequest {
  /** Zero-based page index in the source file. */
  sourcePageIndex: number;
  rotation: PageRotation;
  /** Device pixels per PDF point. */
  pixelsPerPoint: number;
}

/** One line of text found on a page, in page space (points, origin top-left, y down). */
export interface TextRun {
  text: string;
  /** Start of the baseline. */
  x: number;
  baseline: number;
  /** Direction of the text, degrees clockwise; 0 is ordinary left-to-right text. */
  angle: number;
  width: number;
  fontSize: number;
  /** Generic family reported by the PDF engine; the exact font usually cannot be reused. */
  fontFamily: 'sans' | 'serif' | 'mono';
}

export interface RenderJob {
  promise: Promise<ImageBitmap>;
  cancel: () => void;
}

/**
 * A loaded PDF file that can describe and rasterise its pages. The viewer only
 * depends on this interface, so tests can substitute a fake implementation.
 */
/** How a protected source file was opened. Kept in memory only, never written anywhere. */
export interface SourceProtection {
  /** The password the user typed (empty when the file opens without one). */
  password: string;
  /** True when the file's owner did not permit changing, copying or assembling it. */
  restricted: boolean;
}

export interface PdfSource {
  readonly pageCount: number;
  /** Set when the file is encrypted; absent or `null` for ordinary files. */
  readonly protection?: SourceProtection | null;
  getPageInfo(sourcePageIndex: number): Promise<SourcePageInfo>;
  render(request: RenderRequest): RenderJob;
  /** Lines of text on a page, for search and for the "edit text" tool. */
  getTextRuns(sourcePageIndex: number): Promise<TextRun[]>;
  /** The outline (bookmarks) stored in the file; empty when it has none. */
  getOutline(): Promise<OutlineNode[]>;
  /** Comments and links of a page that can be edited; other annotations stay part of the page. */
  getAnnotations(sourcePageIndex: number): Promise<SourceAnnotation[]>;
  /** Files embedded in the document. */
  getAttachments(): Promise<SourceAttachment[]>;
  destroy(): Promise<void>;
}

export type PdfLoadErrorCode = 'corrupt' | 'cancelled' | 'unknown';

export class PdfLoadError extends Error {
  constructor(
    readonly code: PdfLoadErrorCode,
    cause?: unknown,
  ) {
    super(`Cannot load PDF: ${code}`, { cause });
    this.name = 'PdfLoadError';
  }
}

export class RenderCancelledError extends Error {
  constructor() {
    super('Rendering cancelled');
    this.name = 'RenderCancelledError';
  }
}

export type PasswordReason = 'required' | 'incorrect';
/** Resolves with the password, or `null` when the user cancels. */
export type PasswordPrompt = (reason: PasswordReason) => Promise<string | null>;
