/// <reference lib="webworker" />
import { buildPdf, ExportError, type ExportErrorCode, type ExportInput } from './buildPdf';

export type ExportWorkerResponse = { ok: true; bytes: Uint8Array } | { ok: false; error: ExportErrorCode };

// PDF assembly can take seconds for large documents; doing it here keeps the interface responsive.
self.onmessage = async (event: MessageEvent<ExportInput>) => {
  let response: ExportWorkerResponse;
  let transfer: Transferable[] = [];
  try {
    const bytes = await buildPdf(event.data);
    response = { ok: true, bytes };
    transfer = [bytes.buffer];
  } catch (error) {
    if (!(error instanceof ExportError)) console.error(error);
    response = { ok: false, error: error instanceof ExportError ? error.code : 'failed' };
  }
  self.postMessage(response, transfer);
};
