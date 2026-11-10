import {
  DEFAULT_VIEW_STATE,
  type Attachment,
  type Bookmark,
  type DocumentModel,
  type DocumentProtection,
  type PageModel,
  type RecognisedText,
} from '@shared/types/document';
import type { PageLayers } from '@shared/types/layers';
import type { PageObjects } from '@shared/types/objects';
import { decodeImage, type DecodedImage } from '../../engine/images/decodeImage';
import { loadPdf } from '../../engine/pdf/pdfjsSource';
import type { PasswordPrompt, PdfSource } from '../../engine/pdf/types';

/** Building blocks shared by everything that creates documents: PDF files, images, projects. */

type Loader = (data: Uint8Array, askPassword: PasswordPrompt) => Promise<PdfSource>;
type ImageDecoder = (fileName: string, data: Uint8Array) => Promise<DecodedImage>;

let loader: Loader = loadPdf;
let imageDecoder: ImageDecoder = decodeImage;

/** Test hooks: replace the PDF.js loader and the image decoder with fakes. */
export function setPdfLoader(next: Loader | null): void {
  loader = next ?? loadPdf;
}
export function setImageDecoder(next: ImageDecoder | null): void {
  imageDecoder = next ?? decodeImage;
}

/** Parses PDF bytes. The loader takes ownership of the buffer it is given. */
export const loadSource: Loader = (data, askPassword) => loader(data, askPassword);
export const decodeImageFile: ImageDecoder = (fileName, data) => imageDecoder(fileName, data);

export const newId = (): string => crypto.randomUUID();

/** Shared empty values: a document without objects is "unchanged" by identity. */
const NO_OBJECTS: PageObjects = {};
const NO_LAYERS: PageLayers = {};
const NO_BOOKMARKS: Bookmark[] = [];
const NO_ATTACHMENTS: Attachment[] = [];
const NO_RECOGNISED: RecognisedText = {};

/** Document-level content a new document starts with. */
export interface InitialContent {
  bookmarks?: Bookmark[];
  objects?: PageObjects;
  layers?: PageLayers;
  attachments?: Attachment[];
  recognised?: RecognisedText;
  protection?: DocumentProtection | null;
}

const orShared = <T extends object>(value: T | undefined, shared: T): T =>
  value && (Array.isArray(value) ? value.length > 0 : Object.keys(value).length > 0) ? value : shared;

export function createDocument(
  name: string,
  path: string | null,
  pages: PageModel[],
  resourceIds: string[],
  pristine = path !== null,
  content: InitialContent = {},
): DocumentModel {
  const bookmarks = orShared(content.bookmarks, NO_BOOKMARKS);
  const objects = orShared(content.objects, NO_OBJECTS);
  const layers = orShared(content.layers, NO_LAYERS);
  const attachments = orShared(content.attachments, NO_ATTACHMENTS);
  const recognised = orShared(content.recognised, NO_RECOGNISED);
  const protection = content.protection ?? null;
  return {
    id: newId(),
    name,
    path,
    pages,
    selection: [],
    objects,
    layers,
    bookmarks,
    attachments,
    protection,
    // Protection read from the file is already in effect there.
    savedProtection: pristine ? protection : null,
    recognised,
    activeLayers: {},
    selectedObjects: [],
    // What was read from a file is "saved"; imported or merged content exists only in memory.
    savedPages: pristine ? pages : [],
    savedObjects: pristine ? objects : NO_OBJECTS,
    savedLayers: pristine ? layers : NO_LAYERS,
    savedBookmarks: pristine ? bookmarks : NO_BOOKMARKS,
    savedAttachments: pristine ? attachments : NO_ATTACHMENTS,
    savedRecognised: pristine ? recognised : NO_RECOGNISED,
    modified: !pristine,
    history: { past: [], future: [] },
    resourceIds,
    view: DEFAULT_VIEW_STATE,
  };
}
