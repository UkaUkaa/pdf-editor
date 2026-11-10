import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { migrateProjectModel, PROJECT_VERSION, ProjectError, type ProjectModel } from '@shared/schemas/project';
import { readProjectArchive, remapResourceIds, writeProjectArchive, type ProjectFiles } from '@renderer/engine/project/projectArchive';

const bytes = (text: string): Uint8Array => strToU8(text);
const base = { x: 10, y: 20, width: 100, height: 40, rotation: 0, opacity: 1 };

/** A model using every kind of page, object and document-level content. */
function sample(): { model: ProjectModel; files: ProjectFiles } {
  const model: ProjectModel = {
    pages: [
      { id: 'p1', source: { kind: 'pdf', sourceId: 'src1', pageIndex: 0 }, box: { x: 0, y: 0, width: 595, height: 842 }, rotation: 0 },
      { id: 'p2', source: { kind: 'image', assetId: 'img1' }, box: { x: 0, y: 0, width: 300, height: 200 }, rotation: 90 },
      { id: 'p3', source: { kind: 'blank' }, box: { x: 0, y: 0, width: 595, height: 842 }, rotation: 180 },
    ],
    objects: {
      p1: [
        { ...base, id: 'o1', layerId: 'l1', type: 'text', text: 'Привіт, світ', fontFamily: 'serif', fontSize: 14, bold: true, italic: false, color: '#112233', align: 'center', lineHeight: 1.2, background: null, replacesOriginal: true },
        { ...base, id: 'o2', layerId: 'l1', groupId: 'g1', locked: true, type: 'image', assetId: 'img2', flipX: true, flipY: false },
        { ...base, id: 'o3', layerId: 'l2', groupId: 'g1', type: 'shape', shape: 'arrow', stroke: '#ff0000', strokeWidth: 2, fill: null, dashed: true, flipped: true },
        { ...base, id: 'o4', layerId: 'l2', type: 'path', points: [0, 0, 0.5, 1, 1, 0.25], stroke: '#ffe14d', strokeWidth: 12, highlighter: true },
        { ...base, id: 'o5', layerId: 'l2', type: 'note', text: 'Check this', author: 'Alice', createdAt: '2026-01-02T03:04:05.000Z', replies: [{ id: 'r1', text: 'Done', author: 'Bob', createdAt: '2026-01-03T00:00:00.000Z' }], color: '#ffd60a', sourceAnnotation: '11' },
        { ...base, id: 'o6', layerId: 'l2', type: 'link', target: { kind: 'url', url: 'https://example.com' } },
        { ...base, id: 'o7', layerId: 'l2', type: 'link', target: { kind: 'page', pageId: 'p3' }, sourceAnnotation: '14' },
      ],
    },
    layers: {
      p1: [
        { id: 'l1', name: 'Text', type: 'text', visible: true, locked: false, opacity: 1 },
        { id: 'l2', name: 'Заметки', type: 'custom', visible: false, locked: true, opacity: 0.5 },
      ],
    },
    bookmarks: [{ id: 'b1', title: 'Chapter', pageId: 'p1', children: [{ id: 'b2', title: 'Lost', pageId: null, children: [] }] }],
    attachments: [{ id: 'a1', name: 'data.csv', size: 7, resourceId: 'file1' }],
    recognised: { p2: [{ text: 'Счёт № 42', x: 50, baseline: 100, angle: 0, width: 200, fontSize: 16, fontFamily: 'sans' }] },
    sources: [{ id: 'src1', takenAnnotations: { '0': [11, 14] } }],
    assets: [
      { id: 'img1', mime: 'image/jpeg' },
      { id: 'img2', mime: 'image/png' },
    ],
  };
  const files: ProjectFiles = {
    sources: { src1: bytes('%PDF-1.7 the original file') },
    assets: { img1: bytes('jpeg bytes'), img2: bytes('png bytes') },
    attachments: { file1: bytes('a,b\n1,2') },
  };
  return { model, files };
}

const pack = (model: unknown, manifest: unknown = { format: 'pdfproject', version: 1, appVersion: '1', savedAt: 'now', name: 'x' }, extra: Record<string, Uint8Array> = {}): Uint8Array =>
  zipSync({ 'manifest.json': bytes(JSON.stringify(manifest)), 'document.json': bytes(JSON.stringify(model)), ...extra });

const codeOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    if (error instanceof ProjectError) return error.code;
    throw error;
  }
  return 'no error';
};

describe('project archive', () => {
  it('restores exactly what was written', () => {
    const { model, files } = sample();
    const archive = writeProjectArchive('work.pdfproject', '0.9.0', model, files, new Date('2026-11-10T12:00:00Z'));
    const read = readProjectArchive(archive);
    expect(read.model).toEqual(model);
    expect(read.sources).toEqual(files.sources);
    expect(read.assets).toEqual(files.assets);
    expect(read.attachments).toEqual(files.attachments);
    expect(read.manifest).toEqual({ format: 'pdfproject', version: PROJECT_VERSION, appVersion: '0.9.0', savedAt: '2026-11-10T12:00:00.000Z', name: 'work.pdfproject' });
  });

  it('keeps the source PDF byte for byte under a predictable name', () => {
    const { model, files } = sample();
    const entries = unzipSync(writeProjectArchive('x', '1', model, files));
    expect(Object.keys(entries).sort()).toEqual(['assets/img1', 'assets/img2', 'attachments/file1', 'document.json', 'manifest.json', 'sources/src1.pdf']);
    expect(entries['sources/src1.pdf']).toEqual(files.sources['src1']);
  });

  it('refuses to write a model that could not be read back, or one with missing files', () => {
    const { model, files } = sample();
    expect(codeOf(() => writeProjectArchive('x', '1', { ...model, pages: [] }, files))).toBe('corruptProject');
    expect(codeOf(() => writeProjectArchive('x', '1', model, { ...files, sources: {} }))).toBe('corruptProject');
  });

  it('rejects files that are not projects', () => {
    const { model } = sample();
    expect(codeOf(() => readProjectArchive(bytes('%PDF-1.7 not a zip')))).toBe('notProject');
    expect(codeOf(() => readProjectArchive(zipSync({ 'readme.txt': bytes('hi') })))).toBe('notProject');
    expect(codeOf(() => readProjectArchive(pack(model, { format: 'something-else', version: 1 })))).toBe('notProject');
    expect(codeOf(() => readProjectArchive(zipSync({ 'manifest.json': bytes('{broken'), 'document.json': bytes('{}') })))).toBe('corruptProject');
  });

  it('rejects damaged or hostile content', () => {
    const { model, files } = sample();
    const withFiles = { 'sources/src1.pdf': files.sources['src1']!, 'assets/img1': bytes('1'), 'assets/img2': bytes('2'), 'attachments/file1': bytes('3') };
    const read = (changed: unknown, extra: Record<string, Uint8Array> = withFiles): string => codeOf(() => readProjectArchive(pack(changed, undefined, extra)));

    expect(read(model)).toBe('no error');
    // A file the model refers to is missing from the archive.
    expect(read(model, { ...withFiles, 'sources/src1.pdf': undefined as unknown as Uint8Array })).toBe('corruptProject');
    // Ids are used as file names: path traversal must not get through.
    expect(read({ ...model, sources: [{ id: '../../evil', takenAnnotations: {} }] })).toBe('corruptProject');
    expect(read({ ...model, attachments: [{ id: 'a1', name: 'x', size: 1, resourceId: '..\\evil' }] })).toBe('corruptProject');
    // Dangling references.
    expect(read({ ...model, pages: [{ ...model.pages[0]!, source: { kind: 'pdf', sourceId: 'nope', pageIndex: 0 } }] })).toBe('corruptProject');
    expect(read({ ...model, objects: { p1: [{ ...model.objects['p1']![0]!, layerId: 'nope' }] } })).toBe('corruptProject');
    expect(read({ ...model, objects: { ghost: [] } })).toBe('corruptProject');
    expect(read({ ...model, pages: [model.pages[2]!, model.pages[2]!], objects: {}, layers: {} })).toBe('corruptProject');
    // Wrong shapes and absurd numbers.
    expect(read({ ...model, pages: 'many' })).toBe('corruptProject');
    expect(read({ ...model, pages: [{ ...model.pages[2]!, box: { x: 0, y: 0, width: 1e12, height: 10 } }], objects: {}, layers: {} })).toBe('corruptProject');
    expect(read({ ...model, pages: [{ ...model.pages[2]!, rotation: 45 }], objects: {}, layers: {} })).toBe('corruptProject');
    expect(read({ ...model, objects: { p1: [{ ...model.objects['p1']![0]!, fontSize: Number.NaN }] } })).toBe('corruptProject');
  });

  it('enforces size and entry limits from the archive directory', () => {
    const { model, files } = sample();
    const archive = writeProjectArchive('x', '1', model, files);
    expect(codeOf(() => readProjectArchive(archive, { maxSize: 64, maxEntries: 100 }))).toBe('tooLarge');
    expect(codeOf(() => readProjectArchive(archive, { maxSize: 1e9, maxEntries: 3 }))).toBe('tooLarge');
  });

  it('refuses projects of a newer version and migrates older ones', () => {
    const { model } = sample();
    expect(codeOf(() => readProjectArchive(pack(model, { format: 'pdfproject', version: PROJECT_VERSION + 1, appVersion: '9', savedAt: '', name: '' })))).toBe('newerVersion');

    // A pretend version 0 that had no `recognised` field and called bookmarks "outline".
    const { bookmarks, ...rest } = model;
    const old: Record<string, unknown> = { ...rest, outline: bookmarks };
    delete old['recognised'];
    const migrations = {
      0: (value: unknown) => {
        const { outline, ...kept } = value as Record<string, unknown>;
        return { ...kept, bookmarks: outline, recognised: {} };
      },
    };
    expect(migrateProjectModel(old, 0, migrations)).toEqual({ ...model, recognised: {} });
    // Without a migration path the file cannot be understood.
    expect(codeOf(() => migrateProjectModel(old, 0, {}))).toBe('corruptProject');
  });

  it('gives resources fresh ids consistently everywhere', () => {
    const { model, files } = sample();
    const read = readProjectArchive(writeProjectArchive('x', '1', model, files));
    let counter = 0;
    const remapped = remapResourceIds(read, () => `new${(counter += 1)}`);
    const ids = new Set([...Object.keys(remapped.sources), ...Object.keys(remapped.assets), ...Object.keys(remapped.attachments)]);
    expect(ids.size).toBe(4);
    expect([...ids].every((id) => id.startsWith('new'))).toBe(true);

    const source = remapped.model.pages[0]!.source;
    expect(source.kind === 'pdf' && remapped.sources[source.sourceId]).toEqual(files.sources['src1']);
    const imagePage = remapped.model.pages[1]!.source;
    expect(imagePage.kind === 'image' && remapped.assets[imagePage.assetId]).toEqual(files.assets['img1']);
    const image = remapped.model.objects['p1']![1]!;
    expect(image.type === 'image' && remapped.assets[image.assetId]).toEqual(files.assets['img2']);
    expect(remapped.attachments[remapped.model.attachments[0]!.resourceId]).toEqual(files.attachments['file1']);
    expect(remapped.model.sources[0]!.takenAnnotations).toEqual({ '0': [11, 14] });
    // Page, object and layer ids are untouched.
    expect(remapped.model.pages.map((page) => page.id)).toEqual(['p1', 'p2', 'p3']);
  });
});
