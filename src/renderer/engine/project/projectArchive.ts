import { strFromU8, strToU8, unzipSync, zipSync, type Unzipped, type Zippable } from 'fflate';
import {
  manifestSchema,
  migrateProjectModel,
  projectModelSchema,
  PROJECT_FORMAT,
  PROJECT_VERSION,
  ProjectError,
  type ProjectManifest,
  type ProjectModel,
} from '@shared/schemas/project';

/**
 * Reading and writing the `.pdfproject` container: a ZIP archive with
 *
 *   manifest.json            format name, version, application version, time, document name
 *   document.json            pages, objects, layers, bookmarks, recognised text, …
 *   sources/<id>.pdf         the original PDF files, byte for byte
 *   assets/<id>              images placed on pages or used as pages (PNG / JPEG)
 *   attachments/<id>         files attached to the document
 *
 * This module has no dependency on the browser or the application state, so
 * the same code runs in a worker (see projectService.ts), inline and in tests.
 * The synchronous fflate API is used on purpose: the application runs this in
 * a worker of its own, so fflate's helper workers would add nothing.
 */

/** Upper bound for the unpacked size of a project, against decompression bombs. */
export const MAX_PROJECT_SIZE = 2 * 1024 * 1024 * 1024;
const MAX_ENTRIES = 50_000;

export interface ArchiveLimits {
  maxSize: number;
  maxEntries: number;
}
const DEFAULT_LIMITS: ArchiveLimits = { maxSize: MAX_PROJECT_SIZE, maxEntries: MAX_ENTRIES };

export interface ProjectFiles {
  /** Bytes of each source PDF, image asset and attachment, keyed by id. */
  sources: Record<string, Uint8Array>;
  assets: Record<string, Uint8Array>;
  attachments: Record<string, Uint8Array>;
}

export interface ProjectContents extends ProjectFiles {
  manifest: ProjectManifest;
  model: ProjectModel;
}

const sourcePath = (id: string): string => `sources/${id}.pdf`;
const assetPath = (id: string): string => `assets/${id}`;
const attachmentPath = (id: string): string => `attachments/${id}`;

export function writeProjectArchive(name: string, appVersion: string, model: ProjectModel, files: ProjectFiles, now = new Date()): Uint8Array {
  // Never write what could not be read back.
  const checked = projectModelSchema.safeParse(model);
  if (!checked.success) throw new ProjectError('corruptProject', checked.error);
  const manifest: ProjectManifest = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    appVersion,
    savedAt: now.toISOString(),
    name: name.slice(0, 300),
  };
  const entries: Zippable = {
    'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
    'document.json': strToU8(JSON.stringify(model)),
  };
  // PDFs and images are compressed already, and autosave runs often: binary
  // content is stored as it is, which is fast and hardly any larger.
  const stored = { level: 0 } as const;
  const add = (path: string, bytes: Uint8Array | undefined): void => {
    if (!bytes) throw new ProjectError('corruptProject');
    entries[path] = [bytes, stored];
  };
  for (const source of model.sources) add(sourcePath(source.id), files.sources[source.id]);
  for (const asset of model.assets) add(assetPath(asset.id), files.assets[asset.id]);
  for (const attachment of model.attachments) add(attachmentPath(attachment.resourceId), files.attachments[attachment.resourceId]);
  return zipSync(entries, { level: 6 });
}

function unpack(bytes: Uint8Array, limits: ArchiveLimits): Unzipped {
  let total = 0;
  let count = 0;
  let refused = false;
  let files: Unzipped;
  try {
    files = unzipSync(bytes, {
      // Checked from the archive directory, before anything is decompressed.
      filter: (file) => {
        count += 1;
        total += file.originalSize;
        if (count > limits.maxEntries || total > limits.maxSize) refused = true;
        return !refused;
      },
    });
  } catch (error) {
    throw new ProjectError('notProject', error);
  }
  if (refused) throw new ProjectError('tooLarge');
  return files;
}

function readJson(files: Unzipped, path: string): unknown {
  const entry = files[path];
  if (!entry) throw new ProjectError('notProject');
  try {
    return JSON.parse(strFromU8(entry));
  } catch (error) {
    throw new ProjectError('corruptProject', error);
  }
}

/**
 * Reads and validates a project archive. Everything is checked: the manifest,
 * the model (after migration from older versions) and that every file the
 * model refers to is actually present.
 */
export function readProjectArchive(bytes: Uint8Array, limits: ArchiveLimits = DEFAULT_LIMITS): ProjectContents {
  const files = unpack(bytes, limits);
  const manifest = manifestSchema.safeParse(readJson(files, 'manifest.json'));
  if (!manifest.success) throw new ProjectError('notProject', manifest.error);
  const model = migrateProjectModel(readJson(files, 'document.json'), manifest.data.version);

  const collect = (ids: readonly string[], path: (id: string) => string): Record<string, Uint8Array> => {
    const result: Record<string, Uint8Array> = {};
    for (const id of ids) {
      const entry = files[path(id)];
      if (!entry) throw new ProjectError('corruptProject');
      result[id] = entry;
    }
    return result;
  };
  const contents: ProjectContents = {
    manifest: manifest.data,
    model,
    sources: collect(model.sources.map((source) => source.id), sourcePath),
    assets: collect(model.assets.map((asset) => asset.id), assetPath),
    attachments: collect(model.attachments.map((attachment) => attachment.resourceId), attachmentPath),
  };

  // Every reference inside the model must lead somewhere.
  const sourceIds = new Set(model.sources.map((source) => source.id));
  const assetIds = new Set(model.assets.map((asset) => asset.id));
  for (const page of model.pages) {
    if (page.source.kind === 'pdf' && !sourceIds.has(page.source.sourceId)) throw new ProjectError('corruptProject');
    if (page.source.kind === 'image' && !assetIds.has(page.source.assetId)) throw new ProjectError('corruptProject');
  }
  const pageIds = new Set(model.pages.map((page) => page.id));
  if (pageIds.size !== model.pages.length) throw new ProjectError('corruptProject');
  for (const [pageId, objects] of Object.entries(model.objects)) {
    if (!pageIds.has(pageId)) throw new ProjectError('corruptProject');
    const layerIds = new Set((model.layers[pageId] ?? []).map((layer) => layer.id));
    for (const object of objects) {
      if (!layerIds.has(object.layerId)) throw new ProjectError('corruptProject');
      if (object.type === 'image' && !assetIds.has(object.assetId)) throw new ProjectError('corruptProject');
    }
  }
  return contents;
}

/** Gives every resource of a project fresh ids, so two open copies of a project never share resources. */
export function remapResourceIds(contents: ProjectContents, makeId: () => string): ProjectContents {
  const ids = new Map<string, string>();
  const fresh = (old: string): string => {
    if (!ids.has(old)) ids.set(old, makeId());
    return ids.get(old)!;
  };
  const rekey = (record: Record<string, Uint8Array>): Record<string, Uint8Array> =>
    Object.fromEntries(Object.entries(record).map(([key, value]) => [fresh(key), value]));
  const { model } = contents;
  return {
    manifest: contents.manifest,
    sources: rekey(contents.sources),
    assets: rekey(contents.assets),
    attachments: rekey(contents.attachments),
    model: {
      ...model,
      sources: model.sources.map((source) => ({ ...source, id: fresh(source.id) })),
      assets: model.assets.map((asset) => ({ ...asset, id: fresh(asset.id) })),
      attachments: model.attachments.map((attachment) => ({ ...attachment, resourceId: fresh(attachment.resourceId) })),
      pages: model.pages.map((page) => {
        if (page.source.kind === 'pdf') return { ...page, source: { ...page.source, sourceId: fresh(page.source.sourceId) } };
        if (page.source.kind === 'image') return { ...page, source: { ...page.source, assetId: fresh(page.source.assetId) } };
        return page;
      }),
      objects: Object.fromEntries(
        Object.entries(model.objects).map(([pageId, objects]) => [
          pageId,
          objects.map((object) => (object.type === 'image' ? { ...object, assetId: fresh(object.assetId) } : object)),
        ]),
      ),
    },
  };
}
