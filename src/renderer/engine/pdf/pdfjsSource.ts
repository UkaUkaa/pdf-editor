import {
  getDocument,
  GlobalWorkerOptions,
  InvalidPDFException,
  PasswordResponses,
  PermissionFlag,
  RenderingCancelledException,
  type PDFDocumentProxy,
} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { normaliseRotation } from '../coordinates/pageCoordinates';
import {
  PdfLoadError,
  RenderCancelledError,
  type PasswordPrompt,
  type PdfSource,
  type RenderJob,
  type RenderRequest,
  type SourceAnnotation,
  type SourceAttachment,
  type SourcePageInfo,
  type TextRun,
  type SourceProtection,
} from './types';
import type { OutlineNode } from '../bookmarks/bookmarkOperations';
import { mergeTextRuns } from './textRuns';

GlobalWorkerOptions.workerSrc = workerUrl;

/** Static PDF.js resources copied into the bundle by `scripts/copy-pdfjs-assets.mjs`. */
const assetUrl = (directory: string): string => new URL(`./pdfjs/${directory}/`, document.baseURI).href;

/**
 * Upper bound for one rendered page. Beyond it the bitmap is rendered at a
 * lower resolution and stretched, which keeps memory use predictable at high zoom.
 */
export const MAX_CANVAS_PIXELS = 4096 * 4096;

/** Rights needed to edit a document and save the result: change, copy, annotate, assemble. */
const REQUIRED_PERMISSIONS = [
  PermissionFlag.MODIFY_CONTENTS,
  PermissionFlag.COPY,
  PermissionFlag.MODIFY_ANNOTATIONS,
  PermissionFlag.ASSEMBLE,
];

class PdfjsSource implements PdfSource {
  constructor(
    private readonly document: PDFDocumentProxy,
    readonly protection: SourceProtection | null,
  ) {}

  get pageCount(): number {
    return this.document.numPages;
  }

  async getPageInfo(sourcePageIndex: number): Promise<SourcePageInfo> {
    const page = await this.document.getPage(sourcePageIndex + 1);
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = page.view;
    return {
      box: { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) },
      rotation: normaliseRotation(page.rotate),
    };
  }

  render({ sourcePageIndex, rotation, pixelsPerPoint }: RenderRequest): RenderJob {
    let cancelled = false;
    let cancelTask: (() => void) | undefined;

    const promise = (async (): Promise<ImageBitmap> => {
      const page = await this.document.getPage(sourcePageIndex + 1);
      if (cancelled) throw new RenderCancelledError();

      let viewport = page.getViewport({ scale: pixelsPerPoint, rotation });
      const area = viewport.width * viewport.height;
      if (area > MAX_CANVAS_PIXELS) {
        viewport = page.getViewport({ scale: pixelsPerPoint * Math.sqrt(MAX_CANVAS_PIXELS / area), rotation });
      }

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const task = page.render({ canvas, viewport, intent: 'display' });
      cancelTask = () => task.cancel();
      try {
        await task.promise;
        if (cancelled) throw new RenderCancelledError();
        return await createImageBitmap(canvas);
      } catch (error) {
        if (cancelled || error instanceof RenderingCancelledException) throw new RenderCancelledError();
        throw error;
      } finally {
        // Release the backing store immediately instead of waiting for garbage collection.
        canvas.width = 0;
        canvas.height = 0;
      }
    })();

    return {
      promise,
      cancel: () => {
        cancelled = true;
        cancelTask?.();
      },
    };
  }

  async getTextRuns(sourcePageIndex: number): Promise<TextRun[]> {
    const page = await this.document.getPage(sourcePageIndex + 1);
    const content = await page.getTextContent();
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = page.view;
    const left = Math.min(x1, x2);
    const top = Math.max(y1, y2);
    const runs: TextRun[] = [];
    for (const item of content.items) {
      if (!('str' in item) || item.str.trim() === '') continue;
      const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = item.transform as number[];
      const fontSize = Math.hypot(a, b);
      // Mirrored or degenerate text matrices cannot be described by a position and an angle.
      if (fontSize < 0.1 || a * d - b * c <= 0) continue;
      // PDF space has y pointing up, page space down: a counter-clockwise turn there is clockwise here.
      const degrees = (Math.atan2(-b, a) * 180) / Math.PI;
      const angle = Math.abs(degrees) < 0.5 ? 0 : Math.round(degrees * 10) / 10;
      const family = content.styles[item.fontName]?.fontFamily ?? '';
      runs.push({
        text: item.str,
        x: e - left,
        baseline: top - f,
        angle,
        width: item.width,
        fontSize,
        fontFamily: /mono/i.test(family) ? 'mono' : /sans/i.test(family) ? 'sans' : /serif/i.test(family) ? 'serif' : 'sans',
      });
    }
    return mergeTextRuns(runs);
  }

  async getAnnotations(sourcePageIndex: number): Promise<SourceAnnotation[]> {
    const page = await this.document.getPage(sourcePageIndex + 1);
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = page.view;
    const left = Math.min(x1, x2);
    const top = Math.max(y1, y2);
    type Raw = {
      id?: string;
      subtype?: string;
      rect?: number[];
      contentsObj?: { str?: string };
      titleObj?: { str?: string };
      modificationDate?: string | null;
      color?: Uint8ClampedArray | number[] | null;
      inReplyTo?: string | null;
      url?: string;
      dest?: string | unknown[] | null;
    };
    const objectNumber = (id: string | null | undefined): number | null => {
      const match = /^(\d+)R/.exec(id ?? '');
      return match ? Number(match[1]) : null;
    };
    const result: SourceAnnotation[] = [];
    for (const raw of (await page.getAnnotations({ intent: 'any' })) as Raw[]) {
      const number = objectNumber(raw.id);
      const rect = raw.rect;
      if (number === null || !rect || rect.length < 4) continue;
      const [rx1 = 0, ry1 = 0, rx2 = 0, ry2 = 0] = rect;
      const geometry = {
        objectNumber: number,
        x: Math.min(rx1, rx2) - left,
        y: top - Math.max(ry1, ry2),
        width: Math.abs(rx2 - rx1),
        height: Math.abs(ry2 - ry1),
      };
      if (raw.subtype === 'Text') {
        const color = raw.color && raw.color.length >= 3 ? `#${[...raw.color].slice(0, 3).map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}` : null;
        result.push({
          ...geometry,
          kind: 'note',
          text: raw.contentsObj?.str ?? '',
          author: raw.titleObj?.str ?? '',
          modified: raw.modificationDate ?? '',
          color,
          inReplyTo: objectNumber(raw.inReplyTo),
        });
      } else if (raw.subtype === 'Link') {
        let pageIndex: number | null = null;
        if (!raw.url && raw.dest) {
          try {
            const destination = typeof raw.dest === 'string' ? await this.document.getDestination(raw.dest) : raw.dest;
            const target = destination?.[0];
            if (typeof target === 'number') pageIndex = target;
            else if (target && typeof target === 'object') pageIndex = await this.document.getPageIndex(target as never);
          } catch {
            pageIndex = null;
          }
        }
        // Links that are neither a web address nor a page jump (scripts, launch actions…) are
        // left untouched as part of the page; they are never run by this application.
        if (raw.url || pageIndex !== null) result.push({ ...geometry, kind: 'link', url: raw.url ?? null, pageIndex });
      }
    }
    return result;
  }

  async getAttachments(): Promise<SourceAttachment[]> {
    type Raw = { filename?: string; rawFilename?: string; content?: Uint8Array };
    const attachments = (await this.document.getAttachments()) as Map<string, Raw> | Record<string, Raw> | null;
    if (!attachments) return [];
    const entries = attachments instanceof Map ? [...attachments.entries()] : Object.entries(attachments);
    const result: SourceAttachment[] = [];
    for (const [id, raw] of entries.slice(0, 500)) {
      let content = raw.content;
      if (!content) {
        const loaded = (await this.document.getAttachmentContent(id).catch(() => null)) as { content?: Uint8Array } | Uint8Array | null;
        content = loaded instanceof Uint8Array ? loaded : loaded?.content;
      }
      if (content) result.push({ name: raw.filename || raw.rawFilename || id, data: new Uint8Array(content) });
    }
    return result;
  }

  async getOutline(): Promise<OutlineNode[]> {
    type Item = { title: string; dest: string | unknown[] | null; items: Item[] };
    const convert = async (items: Item[], depth: number): Promise<OutlineNode[]> => {
      const nodes: OutlineNode[] = [];
      // Guard against pathological files: outlines are untrusted input too.
      for (const item of items.slice(0, 5000)) {
        let pageIndex: number | null = null;
        try {
          const destination = typeof item.dest === 'string' ? await this.document.getDestination(item.dest) : item.dest;
          const target = destination?.[0];
          if (typeof target === 'number') pageIndex = target;
          else if (target && typeof target === 'object') pageIndex = await this.document.getPageIndex(target as never);
        } catch {
          // A broken destination leaves the bookmark without a target.
        }
        nodes.push({
          title: item.title.trim() || '—',
          pageIndex: pageIndex !== null && pageIndex >= 0 && pageIndex < this.document.numPages ? pageIndex : null,
          children: depth < 24 ? await convert(item.items ?? [], depth + 1) : [],
        });
      }
      return nodes;
    };
    const outline = (await this.document.getOutline()) as Item[] | null;
    return outline ? convert(outline, 0) : [];
  }

  async destroy(): Promise<void> {
    await this.document.loadingTask.destroy();
  }
}

/**
 * Parses a PDF in the PDF.js worker. The file is untrusted input: embedded
 * JavaScript is never executed (no scripting sandbox is loaded) and XFA stays disabled.
 */
export async function loadPdf(data: Uint8Array, askPassword: PasswordPrompt): Promise<PdfSource> {
  const task = getDocument({
    data,
    cMapUrl: assetUrl('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: assetUrl('standard_fonts'),
    wasmUrl: assetUrl('wasm'),
    iccUrl: assetUrl('iccs'),
    enableXfa: false,
    // Canvas drawing stays on the main thread for now; parsing already runs in the worker.
    disableWorkerRendering: true,
  });

  let cancelled = false;
  let lastPassword = '';
  task.onPassword = (updatePassword: (password: string) => void, reason: number) => {
    void askPassword(reason === PasswordResponses.INCORRECT_PASSWORD ? 'incorrect' : 'required').then((password) => {
      if (password === null) {
        cancelled = true;
        void task.destroy();
      } else {
        lastPassword = password;
        updatePassword(password);
      }
    });
  };

  try {
    const document = await task.promise;
    // Permissions are reported only for encrypted files. PDF.js does not tell whether the
    // owner password was used, so restrictions are honoured for any password.
    const permissions = await document.getPermissions().catch(() => null);
    const protection = permissions
      ? { password: lastPassword, restricted: REQUIRED_PERMISSIONS.some((flag) => !permissions.has(flag)) }
      : null;
    return new PdfjsSource(document, protection);
  } catch (error) {
    if (cancelled) throw new PdfLoadError('cancelled', error);
    throw new PdfLoadError(error instanceof InvalidPDFException ? 'corrupt' : 'unknown', error);
  }
}
