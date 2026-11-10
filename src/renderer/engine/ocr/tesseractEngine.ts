import { createWorker, OEM } from 'tesseract.js';
import type { OcrLanguage } from '@shared/types/settings';
import type { OcrLine } from './convert';

export interface OcrEngine {
  /** Recognises the text of one page image. `onProgress` receives values from 0 to 1. */
  recognise(image: Blob, onProgress: (fraction: number) => void): Promise<OcrLine[]>;
  terminate(): Promise<void>;
}

const assetUrl = (path: string): string => new URL(`./tesseract/${path}`, document.baseURI).href;

/**
 * Starts the bundled Tesseract engine in a web worker. The worker script, the
 * WebAssembly core and the language data all come from the application bundle;
 * nothing is downloaded and no page image leaves the computer.
 */
export async function createTesseractEngine(languages: readonly OcrLanguage[]): Promise<OcrEngine> {
  let report: (fraction: number) => void = () => undefined;
  const worker = await createWorker([...languages], OEM.LSTM_ONLY, {
    workerPath: assetUrl('worker.min.js'),
    corePath: assetUrl(''),
    langPath: assetUrl('lang'),
    // Load the worker script directly from the bundle instead of through a blob URL,
    // and keep nothing in browser storage.
    workerBlobURL: false,
    cacheMethod: 'none',
    gzip: true,
    logger: (message) => {
      if (message.status === 'recognizing text') report(message.progress);
    },
  });

  return {
    async recognise(image, onProgress) {
      report = onProgress;
      const { data } = await worker.recognize(image, {}, { text: true, blocks: true });
      report = () => undefined;
      const lines: OcrLine[] = [];
      for (const block of data.blocks ?? []) {
        for (const paragraph of block.paragraphs) {
          for (const line of paragraph.lines) {
            lines.push({ text: line.text, bbox: line.bbox, baseline: line.baseline });
          }
        }
      }
      return lines;
    },
    async terminate() {
      await worker.terminate();
    },
  };
}
