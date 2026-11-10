import { ProjectError, type ProjectModel } from '@shared/schemas/project';
import type { ProjectWorkerRequest, ProjectWorkerResponse } from './project.worker';
import { readProjectArchive, writeProjectArchive, type ProjectContents, type ProjectFiles } from './projectArchive';

/**
 * Packs and unpacks project archives off the main thread. Where workers are
 * unavailable (unit tests) the same code runs inline.
 */
function runInWorker(request: ProjectWorkerRequest): Promise<ProjectWorkerResponse> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./project.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<ProjectWorkerResponse>) => {
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'The project worker failed'));
    };
    // Structured cloning copies the bytes; the originals stay usable for rendering and saving.
    worker.postMessage(request);
  });
}

const fail = (response: Extract<ProjectWorkerResponse, { ok: false }>): never => {
  if (response.error === 'failed') throw new Error('The project could not be processed');
  throw new ProjectError(response.error);
};

export async function packProject(name: string, appVersion: string, model: ProjectModel, files: ProjectFiles): Promise<Uint8Array> {
  if (typeof Worker === 'undefined') return writeProjectArchive(name, appVersion, model, files);
  const response = await runInWorker({ kind: 'pack', name, appVersion, model, files });
  if (!response.ok) return fail(response);
  if (response.kind !== 'pack') throw new Error('Unexpected answer from the project worker');
  return response.bytes;
}

export async function unpackProject(bytes: Uint8Array): Promise<ProjectContents> {
  if (typeof Worker === 'undefined') return readProjectArchive(bytes);
  const response = await runInWorker({ kind: 'unpack', bytes });
  if (!response.ok) return fail(response);
  if (response.kind !== 'unpack') throw new Error('Unexpected answer from the project worker');
  return response.contents;
}
