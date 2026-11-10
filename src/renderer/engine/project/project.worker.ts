/// <reference lib="webworker" />
import { ProjectError, type ProjectErrorCode, type ProjectModel } from '@shared/schemas/project';
import { readProjectArchive, writeProjectArchive, type ProjectContents, type ProjectFiles } from './projectArchive';

export type ProjectWorkerRequest =
  | { kind: 'pack'; name: string; appVersion: string; model: ProjectModel; files: ProjectFiles }
  | { kind: 'unpack'; bytes: Uint8Array };

export type ProjectWorkerResponse =
  | { ok: true; kind: 'pack'; bytes: Uint8Array }
  | { ok: true; kind: 'unpack'; contents: ProjectContents }
  | { ok: false; error: ProjectErrorCode | 'failed' };

// Checksums and (de)compression of large archives take a while; here they do not freeze the interface.
self.onmessage = (event: MessageEvent<ProjectWorkerRequest>) => {
  const request = event.data;
  let response: ProjectWorkerResponse;
  const transfer: Transferable[] = [];
  try {
    if (request.kind === 'pack') {
      const bytes = writeProjectArchive(request.name, request.appVersion, request.model, request.files);
      response = { ok: true, kind: 'pack', bytes };
      transfer.push(bytes.buffer);
    } else {
      const contents = readProjectArchive(request.bytes);
      response = { ok: true, kind: 'unpack', contents };
      for (const group of [contents.sources, contents.assets, contents.attachments]) {
        for (const bytes of Object.values(group)) {
          // Entries may share a buffer; each buffer can be transferred only once.
          if (!transfer.includes(bytes.buffer)) transfer.push(bytes.buffer);
        }
      }
    }
  } catch (error) {
    if (!(error instanceof ProjectError)) console.error(error);
    response = { ok: false, error: error instanceof ProjectError ? error.code : 'failed' };
  }
  self.postMessage(response, transfer);
};
