import fontkit from '@cantoo/fontkit';
import {
  degrees,
  beginText,
  endMarkedContent,
  endText,
  setCharacterSqueeze,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  TextRenderingMode,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFOperator,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  type PDFRef,
} from '@cantoo/pdf-lib';
import type { PageModel, RecognisedLine } from '@shared/types/document';
import type { PageObjects } from '@shared/types/objects';
import { stripAnnotations, writeAnnotations, type AnnotatedPage } from './annotations';
import { drawObjects, type ExportTextLine } from './drawObjects';
import { writeOutline, type ExportBookmark } from './outline';

/**
 * Builds a standard PDF from the page model. Runs in a Web Worker in the
 * application and directly in Node in unit tests; it has no DOM dependencies.
 *
 * Original pages are copied object-for-object, so text stays text and vector
 * graphics stay vector graphics: nothing is rasterised.
 */

export interface ExportAsset {
  bytes: Uint8Array;
  mime: 'image/png' | 'image/jpeg';
}

/** A layer as it is written to the file. */
export interface ExportLayer {
  id: string;
  /** Name shown in the layers panel of PDF readers. */
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
}

export interface ExportInput {
  pages: PageModel[];
  /** Bytes of every source PDF referenced by `pages`, keyed by source id. */
  sources: Record<string, Uint8Array>;
  /** Image assets referenced by `pages`, keyed by asset id. */
  assets: Record<string, ExportAsset>;
  /** Objects drawn on top of the pages, keyed by page id. */
  objects?: PageObjects;
  /**
   * Layers of each page, bottom to top. They become optional content groups, so PDF
   * readers can show and hide them. Pages without an entry are written without layers.
   */
  layers?: Record<string, ExportLayer[]>;
  /** Bundled font files needed by text objects, keyed by file name. */
  fonts?: Record<string, Uint8Array>;
  /** Line layout of every text object, computed with the same code that draws it on screen. */
  textLines?: Record<string, ExportTextLine[]>;
  /** Document outline; page targets are indexes into `pages`. */
  bookmarks?: ExportBookmark[];
  /**
   * Annotations of source pages that became editable objects and must not be copied
   * along with the page: object numbers per source id and zero-based page index.
   */
  takenAnnotations?: Record<string, Record<number, number[]>>;
  /** Files embedded in the document. */
  attachments?: Array<{ name: string; bytes: Uint8Array }>;
  /**
   * Text recognised by OCR, per page id. It is written invisibly on top of the page,
   * which makes scanned pages searchable and their text selectable in any reader.
   */
  hiddenText?: Record<string, RecognisedLine[]>;
  /**
   * Passwords of protected source files, keyed by source id: what the user typed to open
   * them. Without the right one such a source cannot be read and the export fails.
   */
  sourcePasswords?: Record<string, string>;
  /** When set, the output is encrypted (AES-256) and opens only with this password. */
  password?: string;
  title?: string;
}

export type ExportErrorCode = 'encryptedSource' | 'restrictedSource' | 'missingResource' | 'validationFailed' | 'failed';

export class ExportError extends Error {
  constructor(
    readonly code: ExportErrorCode,
    cause?: unknown,
  ) {
    super(`PDF export failed: ${code}`, { cause });
    this.name = 'ExportError';
  }
}

const PRODUCER = 'PDF Editor';
/** Font used for the invisible OCR text layer (it is never seen, only measured and extracted). */
export const HIDDEN_TEXT_FONT = 'DejaVuSans.ttf';

async function loadSource(bytes: Uint8Array, password?: string): Promise<PDFDocument> {
  try {
    // Without the right password a protected file is refused here; it is never copied undecrypted.
    return await PDFDocument.load(bytes, { updateMetadata: false, ...(password === undefined ? {} : { password }) });
  } catch (error) {
    if (error instanceof Error && /encrypt|password/i.test(error.message)) throw new ExportError('encryptedSource', error);
    throw new ExportError('failed', error);
  }
}

export async function buildPdf(input: ExportInput): Promise<Uint8Array> {
  // Metadata is set explicitly; pdf-lib would otherwise stamp its own producer string.
  const output = await PDFDocument.create({ updateMetadata: false });
  const now = new Date();
  output.setProducer(PRODUCER);
  output.setCreator(PRODUCER);
  output.setCreationDate(now);
  output.setModificationDate(now);
  if (input.title) output.setTitle(input.title);

  // --- Copy pages from the source PDFs ---------------------------------------------------
  // One `copyPages` call shares resources (fonts, images) between the pages it copies, but
  // must not be asked for the same page twice. Repeated pages (duplicates) therefore go
  // into later batches: the n-th use of a page is copied by the n-th call.
  const copied = new Map<PageModel, PDFPage>();
  const batches = new Map<string, Array<Array<{ page: PageModel; pageIndex: number }>>>();
  const uses = new Map<string, number>();
  for (const page of input.pages) {
    if (page.source.kind !== 'pdf') continue;
    const { sourceId, pageIndex } = page.source;
    const key = `${sourceId}:${pageIndex}`;
    const use = uses.get(key) ?? 0;
    uses.set(key, use + 1);
    const sourceBatches = batches.get(sourceId) ?? [];
    batches.set(sourceId, sourceBatches);
    (sourceBatches[use] ??= []).push({ page, pageIndex });
  }

  let metadataCopied = false;
  for (const [sourceId, sourceBatches] of batches) {
    const bytes = input.sources[sourceId];
    if (!bytes) throw new ExportError('missingResource');
    const source = await loadSource(bytes, input.sourcePasswords?.[sourceId]);
    if (!metadataCopied && !input.title) {
      // Keep the descriptive metadata of the first source document.
      const title = source.getTitle();
      const author = source.getAuthor();
      const subject = source.getSubject();
      if (title) output.setTitle(title);
      if (author) output.setAuthor(author);
      if (subject) output.setSubject(subject);
      metadataCopied = true;
    }
    for (const [pageIndex, numbers] of Object.entries(input.takenAnnotations?.[sourceId] ?? {})) {
      const sourcePage = source.getPages()[Number(pageIndex)];
      if (sourcePage) stripAnnotations(sourcePage, new Set(numbers));
    }
    for (const batch of sourceBatches) {
      if (batch.some(({ pageIndex }) => pageIndex < 0 || pageIndex >= source.getPageCount())) {
        throw new ExportError('missingResource');
      }
      const pages = await output.copyPages(
        source,
        batch.map(({ pageIndex }) => pageIndex),
      );
      batch.forEach(({ page }, index) => copied.set(page, pages[index]!));
    }
  }

  // --- Shared resources for objects --------------------------------------------------------
  const embeddedImages = new Map<string, PDFImage>();
  const embedImage = async (assetId: string): Promise<PDFImage> => {
    let image = embeddedImages.get(assetId);
    if (!image) {
      const asset = input.assets[assetId];
      if (!asset) throw new ExportError('missingResource');
      image = asset.mime === 'image/png' ? await output.embedPng(asset.bytes) : await output.embedJpg(asset.bytes);
      embeddedImages.set(assetId, image);
    }
    return image;
  };
  const embeddedFonts = new Map<string, PDFFont>();
  const embedFont = async (fileName: string): Promise<PDFFont> => {
    let font = embeddedFonts.get(fileName);
    if (!font) {
      const bytes = input.fonts?.[fileName];
      if (!bytes) throw new ExportError('missingResource');
      output.registerFontkit(fontkit);
      // Only the glyphs actually used are embedded.
      font = await output.embedFont(bytes, { subset: true });
      embeddedFonts.set(fileName, font);
    }
    return font;
  };
  /** Writes recognised text in text rendering mode 3 (neither filled nor stroked). */
  const drawHiddenText = async (page: PageModel, pdfPage: PDFPage): Promise<void> => {
    const lines = input.hiddenText?.[page.id];
    if (!lines?.length) return;
    const font = await embedFont(HIDDEN_TEXT_FONT);
    const fontKey = pdfPage.node.newFontDictionary(font.name, font.ref);
    const top = page.box.y + page.box.height;
    for (const line of lines) {
      if (line.text.trim() === '' || line.fontSize <= 0) continue;
      const natural = font.widthOfTextAtSize(line.text, line.fontSize);
      // Stretch or squeeze the glyphs so the line covers exactly the area it was read from.
      const squeeze = natural > 0 && line.width > 0 ? Math.min(1000, Math.max(10, (line.width / natural) * 100)) : 100;
      const angle = (line.angle * Math.PI) / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      pdfPage.pushOperators(
        beginText(),
        setTextRenderingMode(TextRenderingMode.Invisible),
        setFontAndSize(fontKey, line.fontSize),
        setCharacterSqueeze(squeeze),
        // Page space has y pointing down, PDF space up: a clockwise turn there is counter-clockwise here.
        setTextMatrix(cos, -sin, sin, cos, page.box.x + line.x, top - line.baseline),
        showText(font.encodeText(line.text)),
        endText(),
      );
    }
  };

  const optionalContent: Array<{ ref: PDFRef; layer: ExportLayer }> = [];
  const drawPageObjects = async (page: PageModel, pdfPage: PDFPage, isolate: boolean): Promise<void> => {
    const objects = input.objects?.[page.id];
    const hasHiddenText = (input.hiddenText?.[page.id]?.length ?? 0) > 0;
    if (!objects?.length && !hasHiddenText) return;
    if (isolate) {
      // Original content may leave the graphics state changed; wrap it in q … Q so
      // that our drawing starts from a clean state.
      pdfPage.node.normalize();
      const context = output.context;
      pdfPage.node.wrapContentStreams(context.register(context.stream('q')), context.register(context.stream('Q')));
    }
    await drawHiddenText(page, pdfPage);
    if (!objects?.length) return;
    const resources = { font: embedFont, image: embedImage, textLines: input.textLines ?? {} };
    const layers = input.layers?.[page.id];
    if (!layers) {
      await drawObjects(output, pdfPage, page.box, objects, resources);
      return;
    }
    for (const layer of layers) {
      const onLayer = objects.filter((object) => object.layerId === layer.id);
      if (onLayer.length === 0) continue;
      // Everything drawn between BDC and EMC belongs to the layer's optional content group.
      const group = output.context.register(
        output.context.obj({ Type: 'OCG', Name: PDFHexString.fromText(layer.name) }),
      );
      optionalContent.push({ ref: group, layer });
      const pageResources = pdfPage.node.normalizedEntries().Resources;
      let properties = pageResources.lookupMaybe(PDFName.of('Properties'), PDFDict);
      if (!properties) {
        properties = output.context.obj({});
        pageResources.set(PDFName.of('Properties'), properties);
      }
      const key = PDFName.of(`OC${optionalContent.length}`);
      properties.set(key, group);
      pdfPage.pushOperators(PDFOperator.of('BDC' as never, [PDFName.of('OC'), key]));
      await drawObjects(
        output,
        pdfPage,
        page.box,
        layer.opacity === 1 ? onLayer : onLayer.map((object) => ({ ...object, opacity: object.opacity * layer.opacity })),
        resources,
      );
      pdfPage.pushOperators(endMarkedContent());
    }
  };

  // --- Assemble the output in document order ---------------------------------------------
  const annotated: AnnotatedPage[] = [];
  /** Notes and links of a page that are on visible layers (or on no layer at all). */
  const annotationObjects = (pageId: string) => {
    const objects = input.objects?.[pageId] ?? [];
    const layers = input.layers?.[pageId];
    if (!layers) return objects;
    const visible = new Set(layers.filter((layer) => layer.visible).map((layer) => layer.id));
    return objects.filter((object) => visible.has(object.layerId));
  };
  for (const page of input.pages) {
    if (page.source.kind === 'pdf') {
      const pdfPage = copied.get(page);
      if (!pdfPage) throw new ExportError('missingResource');
      pdfPage.setRotation(degrees(page.rotation));
      output.addPage(pdfPage);
      await drawPageObjects(page, pdfPage, true);
      annotated.push({ pageId: page.id, page: pdfPage, box: page.box, objects: annotationObjects(page.id) });
      continue;
    }

    const pdfPage = output.addPage([page.box.width, page.box.height]);
    pdfPage.setRotation(degrees(page.rotation));
    if (page.source.kind === 'image') {
      const image = await embedImage(page.source.assetId);
      pdfPage.drawImage(image, { x: 0, y: 0, width: page.box.width, height: page.box.height });
    }
    await drawPageObjects(page, pdfPage, false);
    annotated.push({ pageId: page.id, page: pdfPage, box: page.box, objects: annotationObjects(page.id) });
  }

  writeAnnotations(output, annotated);
  for (const attachment of input.attachments ?? []) {
    await output.attach(attachment.bytes, attachment.name, { mimeType: 'application/octet-stream' });
  }

  writeOutline(output, input.bookmarks ?? []);

  if (optionalContent.length > 0) {
    // Readers list layers top-most first, like the layers panel of this application.
    const listed = [...optionalContent].reverse();
    output.catalog.set(
      PDFName.of('OCProperties'),
      output.context.obj({
        OCGs: optionalContent.map((entry) => entry.ref),
        D: {
          Order: listed.map((entry) => entry.ref),
          OFF: optionalContent.filter((entry) => !entry.layer.visible).map((entry) => entry.ref),
          Locked: optionalContent.filter((entry) => entry.layer.locked).map((entry) => entry.ref),
        },
      }),
    );
  }

  if (input.password) {
    // One password both opens the file and gives full rights: whoever can open it may do everything.
    output.encrypt({
      userPassword: input.password,
      ownerPassword: input.password,
      permissions: {
        printing: 'highResolution',
        modifying: true,
        copying: true,
        annotating: true,
        fillingForms: true,
        contentAccessibility: true,
        documentAssembly: true,
      },
    });
  }
  const bytes = await output.save();
  await validateOutput(bytes, input.pages, input.password);
  return bytes;
}

/** Re-reads the generated file and checks that it has exactly the expected pages. */
async function validateOutput(bytes: Uint8Array, expected: readonly PageModel[], password?: string): Promise<void> {
  let reloaded: PDFDocument;
  try {
    reloaded = await PDFDocument.load(bytes, { updateMetadata: false, ...(password ? { password } : {}) });
  } catch (error) {
    throw new ExportError('validationFailed', error);
  }
  if (password) {
    // A protected file must not open without its password.
    const openWithoutPassword = await PDFDocument.load(bytes, { updateMetadata: false }).then(
      () => true,
      () => false,
    );
    if (openWithoutPassword) throw new ExportError('validationFailed');
  }
  const pages = reloaded.getPages();
  const matches =
    pages.length === expected.length &&
    pages.every((page, index) => ((page.getRotation().angle % 360) + 360) % 360 === expected[index]!.rotation);
  if (!matches) throw new ExportError('validationFailed');
}
