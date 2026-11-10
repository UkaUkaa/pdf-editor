import { create } from 'zustand';
import type { RecognisedText } from '@shared/types/document';
import type { OcrLanguage } from '@shared/types/settings';
import { toRecognisedLines } from '../../engine/ocr/convert';
import type { OcrEngine } from '../../engine/ocr/tesseractEngine';
import { getTextRuns, renderPage } from '../../engine/rendering/pageRenderer';
import { i18n } from '../../localization/i18n';
import { getActiveDocument, getDocument, useDocumentsStore } from '../../stores/documentsStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUiStore } from '../../stores/uiStore';
import { pagesInScope, type StampScope } from '../stamps/stampActions';

/** Pages are rasterised at about 200 dpi for recognition: enough for body text, light on memory. */
const OCR_PIXELS_PER_POINT = 200 / 72;

type EngineFactory = (languages: readonly OcrLanguage[]) => Promise<OcrEngine>;
type PageImageSource = (documentId: string, pageId: string) => Promise<{ image: Blob; width: number } | null>;

/** Renders a page as displayed and encodes it as PNG for the OCR engine. */
const renderPageImage: PageImageSource = async (documentId, pageId) => {
  const page = getDocument(documentId)?.pages.find((candidate) => candidate.id === pageId);
  // A blank page has nothing to read.
  if (!page || page.source.kind === 'blank') return null;
  const bitmap = await renderPage(documentId, page, OCR_PIXELS_PER_POINT).promise;
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  // Recognition needs dark text on a light ground: transparent areas are paper.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0);
  const image = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  const width = canvas.width;
  canvas.width = 0;
  canvas.height = 0;
  return image ? { image, width } : null;
};

let engineFactory: EngineFactory = async (languages) => (await import('../../engine/ocr/tesseractEngine')).createTesseractEngine(languages);
let pageImageSource: PageImageSource = renderPageImage;

/** Test hooks: replace the recognition engine and the page rasteriser. */
export function setOcrEngineFactory(next: EngineFactory | null, images: PageImageSource | null = null): void {
  engineFactory = next ?? (async (languages) => (await import('../../engine/ocr/tesseractEngine')).createTesseractEngine(languages));
  pageImageSource = images ?? renderPageImage;
}

interface OcrState {
  running: boolean;
  /** Pages finished and pages to do in the current run. */
  done: number;
  total: number;
  /** Progress within the page being recognised, 0 … 1. */
  pageProgress: number;
  cancelled: boolean;
}

/** Progress of the OCR run, shown in the OCR dialog. */
export const useOcrStore = create<OcrState>(() => ({ running: false, done: 0, total: 0, pageProgress: 0, cancelled: false }));

let activeEngine: OcrEngine | null = null;

/** Stops the run in progress. Pages recognised so far are kept. */
export function cancelOcr(): void {
  if (!useOcrStore.getState().running) return;
  useOcrStore.setState({ cancelled: true });
  // Terminating the worker is the only way to interrupt a page in the middle.
  void activeEngine?.terminate().catch(() => undefined);
}

export interface OcrOptions {
  languages: OcrLanguage[];
  /** Every page, the selected pages, or exactly the page that is open now. */
  scope: StampScope | 'current';
  /** Leave out pages that already have real text. */
  skipPagesWithText: boolean;
}

/**
 * Recognises text on the pages in scope. Runs in a worker and keeps the
 * interface responsive; the result of all pages is one undoable step.
 * Resolves with the number of pages on which text was found.
 */
export async function runOcr(options: OcrOptions): Promise<number> {
  const document = getActiveDocument();
  if (!document || useOcrStore.getState().running || options.languages.length === 0) return 0;
  const openPage = document.pages[document.view.currentPage];
  const pages = options.scope === 'current' ? (openPage ? [openPage] : []) : pagesInScope(document, options.scope);
  useOcrStore.setState({ running: true, done: 0, total: pages.length, pageProgress: 0, cancelled: false });

  const recognised: RecognisedText = {};
  let failed = false;
  try {
    activeEngine = await engineFactory(options.languages);
    for (const page of pages) {
      if (useOcrStore.getState().cancelled) break;
      const hasText =
        options.skipPagesWithText &&
        page.source.kind === 'pdf' &&
        (await getTextRuns(page.source.sourceId, page.source.pageIndex).catch(() => [])).length > 0;
      if (!hasText) {
        const rendered = await pageImageSource(document.id, page.id);
        if (rendered && !useOcrStore.getState().cancelled) {
          const lines = await activeEngine.recognise(rendered.image, (pageProgress) => useOcrStore.setState({ pageProgress }));
          const converted = toRecognisedLines(lines, page, rendered.width);
          if (converted.length > 0) recognised[page.id] = converted;
        }
      }
      useOcrStore.setState((state) => ({ done: state.done + 1, pageProgress: 0 }));
    }
  } catch (error) {
    // A cancelled run ends with the worker being terminated, which is not an error.
    if (!useOcrStore.getState().cancelled) {
      failed = true;
      console.error('OCR failed', error);
    }
  } finally {
    const engine = activeEngine;
    activeEngine = null;
    await engine?.terminate().catch(() => undefined);
    useOcrStore.setState({ running: false });
  }

  const count = Object.keys(recognised).length;
  const current = getDocument(document.id);
  if (current && count > 0) {
    // Only pages that still exist get their text.
    const existing = new Set(current.pages.map((page) => page.id));
    const kept = Object.fromEntries(Object.entries(recognised).filter(([pageId]) => existing.has(pageId)));
    useDocumentsStore.getState().commit(current.id, { recognised: { ...current.recognised, ...kept } });
  }
  const ui = useUiStore.getState();
  if (failed) ui.showNotice({ titleKey: 'ocr.failedTitle', lines: [i18n.t('ocr.failed')] });
  else if (!useOcrStore.getState().cancelled || count > 0) {
    ui.showNotice({ titleKey: 'ocr.doneTitle', lines: [i18n.t('ocr.done', { count, total: pages.length })] });
  }
  return count;
}

/**
 * Recognition straight from the toolbar, without the options dialog: the
 * languages from the preferences, either the page that is open or the whole
 * document. Progress and the Cancel button are shown in the OCR dialog.
 */
export async function quickOcr(scope: 'current' | 'all'): Promise<number> {
  if (!getActiveDocument() || useOcrStore.getState().running) return 0;
  const ui = useUiStore.getState();
  ui.openDialog('ocr');
  try {
    return await runOcr({
      languages: useSettingsStore.getState().settings.ocrLanguages,
      scope,
      // A page the user points at is recognised even if it has some text; a whole
      // document leaves its text pages alone.
      skipPagesWithText: scope === 'all',
    });
  } finally {
    if (useUiStore.getState().dialog === 'ocr') useUiStore.getState().closeDialog();
  }
}
