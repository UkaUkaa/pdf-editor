import type { DocumentModel, PageModel } from '@shared/types/document';
import type { Layer } from '@shared/types/layers';
import type { EditorObject, FontFamily, TextAlign, TextObject } from '@shared/types/objects';
import { DEFAULT_TOOL_STYLE, TEXT_PADDING } from '@shared/types/objects';
import { displaySize, pageGeometry, type Point } from '../../engine/coordinates/pageCoordinates';
import { createLayer, uniqueLayerName } from '../../engine/layers/layerOperations';
import { createTextObject, fitTextHeight } from '../../engine/objects/factory';
import { displayToPage } from '../../engine/objects/geometry';
import { measureText } from '../../engine/objects/textLayout';
import { i18n } from '../../localization/i18n';
import { getActiveDocument, useDocumentsStore } from '../../stores/documentsStore';
import { targetPageIds } from '../documents/documentActions';

export type StampScope = 'all' | 'selection';

/** Pages a stamp applies to: every page, or the selected pages (the current one when nothing is selected). */
export function pagesInScope(document: DocumentModel, scope: StampScope): PageModel[] {
  if (scope === 'all') return document.pages;
  const targets = targetPageIds(document);
  return document.pages.filter((page) => targets.has(page.id));
}

interface TextStamp {
  text: string;
  fontFamily?: FontFamily;
  fontSize: number;
  color: string;
  opacity: number;
  bold?: boolean;
  align?: TextAlign;
}

/**
 * Builds a single-line-per-paragraph text object centred on `centre`, where
 * `centre` and `rotation` refer to the page as displayed. Objects live in
 * unrotated page space, so both are converted for rotated pages.
 */
function stampObject(page: PageModel, stamp: TextStamp, centre: Point, rotation: number): TextObject {
  const base: TextObject = {
    ...createTextObject({ x: 0, y: 0 }, DEFAULT_TOOL_STYLE, stamp.text),
    fontFamily: stamp.fontFamily ?? 'sans',
    fontSize: stamp.fontSize,
    bold: stamp.bold ?? false,
    color: stamp.color,
    opacity: stamp.opacity,
    align: stamp.align ?? 'center',
  };
  const widest = Math.max(...stamp.text.split('\n').map((line) => measureText(line, base)));
  const sized = fitTextHeight({ ...base, width: widest + TEXT_PADDING * 2 + 1 });
  const onPage = displayToPage(centre, page.box, page.rotation);
  return {
    ...sized,
    x: onPage.x - sized.width / 2,
    y: onPage.y - sized.height / 2,
    rotation: (((rotation - page.rotation) % 360) + 360) % 360,
  };
}

/** Adds stamp objects to pages on a dedicated layer per page, all as one undoable step. */
function applyStamps(
  document: DocumentModel,
  layerName: string,
  build: (page: PageModel, pageNumber: number) => TextObject[],
  pages: readonly PageModel[],
): number {
  const objects = { ...document.objects };
  const layers = { ...document.layers };
  let created = 0;
  for (const page of pages) {
    const stamps = build(page, document.pages.indexOf(page) + 1);
    if (stamps.length === 0) continue;
    const pageLayers: Layer[] = layers[page.id] ?? [];
    // Stamps of one kind share a layer, so they can be hidden or removed together.
    let layer = pageLayers.find((candidate) => candidate.name === layerName && candidate.visible && !candidate.locked);
    if (!layer) {
      layer = createLayer(crypto.randomUUID(), uniqueLayerName(pageLayers, layerName), 'annotation');
      layers[page.id] = [...pageLayers, layer];
    }
    const layerId = layer.id;
    const added: EditorObject[] = stamps.map((stamp) => ({ ...stamp, layerId }));
    objects[page.id] = [...(objects[page.id] ?? []), ...added];
    created += added.length;
  }
  if (created > 0) useDocumentsStore.getState().commit(document.id, { objects, layers });
  return created;
}

export interface WatermarkOptions {
  text: string;
  fontSize: number;
  color: string;
  /** 0 … 1. */
  opacity: number;
  /** Degrees, clockwise as seen on the page; -45 runs from bottom-left to top-right. */
  angle: number;
  scope: StampScope;
}

/** Puts a text watermark in the centre of each page in scope. Returns the number of pages stamped. */
export function addWatermark(options: WatermarkOptions): number {
  const document = getActiveDocument();
  const text = options.text.trim();
  if (!document || text === '') return 0;
  return applyStamps(
    document,
    i18n.t('stamps.watermarkLayer'),
    (page) => {
      const size = displaySize(pageGeometry(page));
      const stamp = { text, fontSize: options.fontSize, color: options.color, opacity: options.opacity, bold: true };
      return [stampObject(page, stamp, { x: size.width / 2, y: size.height / 2 }, options.angle)];
    },
    pagesInScope(document, options.scope),
  );
}

export interface HeaderFooterOptions {
  /** Text with the placeholders `{page}` and `{pages}`; empty for none. */
  header: string;
  footer: string;
  align: TextAlign;
  fontSize: number;
  /** Distance from the page edge, in points. */
  margin: number;
  scope: StampScope;
}

/** Replaces `{page}` and `{pages}` with the page number and the page count. */
export function fillPlaceholders(template: string, page: number, pages: number): string {
  return template.replaceAll('{page}', String(page)).replaceAll('{pages}', String(pages));
}

/** Adds a header and/or footer line to each page in scope. Returns the number of lines added. */
export function addHeaderFooter(options: HeaderFooterOptions): number {
  const document = getActiveDocument();
  if (!document || (options.header.trim() === '' && options.footer.trim() === '')) return 0;
  const total = document.pages.length;
  return applyStamps(
    document,
    i18n.t('stamps.headerFooterLayer'),
    (page, pageNumber) => {
      const size = displaySize(pageGeometry(page));
      const stamps: TextObject[] = [];
      const place = (template: string, y: number): void => {
        const text = fillPlaceholders(template, pageNumber, total).trim();
        if (text === '') return;
        const stamp = { text, fontSize: options.fontSize, color: '#111827', opacity: 1 };
        const object = stampObject(page, stamp, { x: size.width / 2, y }, 0);
        // Shift from the centre to the requested side, keeping the margin.
        const reach = size.width / 2 - options.margin - object.width / 2;
        const shift = options.align === 'left' ? -reach : options.align === 'right' ? reach : 0;
        stamps.push(shift === 0 ? object : stampObject(page, stamp, { x: size.width / 2 + shift, y }, 0));
      };
      const lineHeight = options.fontSize * 1.2 + TEXT_PADDING * 2;
      place(options.header, options.margin + lineHeight / 2);
      place(options.footer, size.height - options.margin - lineHeight / 2);
      return stamps;
    },
    pagesInScope(document, options.scope),
  );
}
