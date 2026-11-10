import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpenFileResult } from '@shared/types/document';
import { DEFAULT_SETTINGS } from '@shared/types/settings';
import { DEFAULT_TOOL_STYLE } from '@shared/types/objects';
import { App } from '@renderer/app/App';
import { createShapeObject, createTextObject } from '@renderer/engine/objects/factory';
import { closeDocument } from '@renderer/features/documents/documentActions';
import { addObject } from '@renderer/features/pdf-editor/objectActions';
import { autosaveNow } from '@renderer/features/project/autosave';
import { executeCommand } from '@renderer/services/commands';
import { getActiveDocument, useDocumentsStore } from '@renderer/stores/documentsStore';
import { fakeFile, mockViewportSize, setupApp, type FakeApi } from './testUtils';

const run = (id: Parameters<typeof executeCommand>[0]): void => act(() => void executeCommand(id));
const doc = () => getActiveDocument()!;
const documents = () => useDocumentsStore.getState().documents;

const projectFile = (name: string, data: Uint8Array): OpenFileResult => ({
  ok: true,
  file: { path: `/docs/${name}`, name, size: data.length, data: data.slice() },
});

async function openFile(api: FakeApi, result: OpenFileResult, tab: string): Promise<void> {
  api.dialogResults = [result];
  run('file.open');
  await screen.findByRole('tab', { name: tab });
}

/** Opens an annotated PDF (comments, links, an attachment, an outline is not included) and edits it. */
async function openAndEdit(api: FakeApi): Promise<void> {
  mockViewportSize(1000, 700);
  render(<App />);
  await openFile(api, fakeFile('report.pdf', '3::annotated'), 'report.pdf');
  const pageId = doc().pages[0]!.id;
  act(() => addObject(doc().id, pageId, createTextObject({ x: 100, y: 200 }, DEFAULT_TOOL_STYLE, 'Правка')));
  act(() => addObject(doc().id, doc().pages[1]!.id, createShapeObject('rect', { x: 10, y: 10 }, { x: 110, y: 60 }, DEFAULT_TOOL_STYLE)));
}

async function saveAsProject(api: FakeApi, path: string): Promise<Uint8Array> {
  api.savePath = path;
  run('file.saveProject');
  await waitFor(() => expect(api.written.at(-1)?.path).toBe(path));
  return api.written.at(-1)!.data;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('project files', () => {
  it('saves a project that keeps everything editable and reopens it unchanged', async () => {
    const api = await setupApp();
    await openAndEdit(api);
    const before = doc();
    const data = await saveAsProject(api, '/docs/work.pdfproject');

    // The dialog was asked for a project; the document now belongs to that file.
    expect(api.documents.saveDialog).toHaveBeenLastCalledWith('/docs/report.pdf', 'project');
    await waitFor(() => expect(doc().modified).toBe(false));
    expect(doc().path).toBe('/docs/work.pdfproject');
    expect(await screen.findByRole('tab', { name: 'work.pdfproject' })).toBeInTheDocument();
    expect(api.recentFiles[0]?.path).toBe('/docs/work.pdfproject');

    // It is a real archive holding the original PDF bytes, not a flattened copy.
    const entries = unzipSync(data);
    expect(Object.keys(entries).filter((name) => name.startsWith('sources/'))).toHaveLength(1);
    expect(new TextDecoder().decode(Object.entries(entries).find(([name]) => name.startsWith('sources/'))![1])).toBe('3::annotated');
    expect(JSON.parse(new TextDecoder().decode(entries['manifest.json']))).toMatchObject({ format: 'pdfproject', version: 1, appVersion: '9.9.9' });

    await act(() => closeDocument(doc().id));
    expect(documents()).toHaveLength(0);
    await openFile(api, projectFile('work.pdfproject', data), 'work.pdfproject');

    const after = doc();
    expect(after.modified).toBe(false);
    expect(after.pages.map((page) => [page.id, page.box, page.rotation])).toEqual(before.pages.map((page) => [page.id, page.box, page.rotation]));
    expect(after.objects).toEqual(before.objects);
    expect(after.layers).toEqual(before.layers);
    expect(after.attachments.map((attachment) => [attachment.name, attachment.size])).toEqual([['data.csv', 8]]);
    // Objects are objects again, not page content: they can be selected and undone into.
    const text = after.objects[after.pages[0]!.id]!.find((object) => object.type === 'text');
    expect(text).toMatchObject({ text: 'Правка', x: 100, y: 200 });
    // Comments of the source file are not imported a second time.
    expect(after.objects[after.pages[0]!.id]!.filter((object) => object.type === 'note')).toHaveLength(1);
  });

  it('saves a project in place and exports it to PDF without changing its file', async () => {
    const api = await setupApp();
    await openAndEdit(api);
    await saveAsProject(api, '/docs/work.pdfproject');
    await waitFor(() => expect(doc().modified).toBe(false));

    act(() => addObject(doc().id, doc().pages[2]!.id, createTextObject({ x: 5, y: 5 }, DEFAULT_TOOL_STYLE, 'more')));
    expect(doc().modified).toBe(true);
    run('file.save');
    await waitFor(() => expect(doc().modified).toBe(false));
    expect(api.written).toHaveLength(2);
    expect(api.written[1]!.path).toBe('/docs/work.pdfproject');
    expect([...api.written[1]!.data.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);

    api.savePath = '/docs/work.pdf';
    run('file.exportPdf');
    await waitFor(() => expect(api.written).toHaveLength(3));
    expect(api.documents.saveDialog).toHaveBeenLastCalledWith('work', 'pdf');
    expect(new TextDecoder().decode(api.written[2]!.data)).toMatch(/^%PDF-fake/);
    expect(doc().path).toBe('/docs/work.pdfproject');

    // "Save As" keeps the kind of the document.
    api.savePath = '/docs/other.pdfproject';
    run('file.saveAs');
    await waitFor(() => expect(doc().path).toBe('/docs/other.pdfproject'));
    expect(api.documents.saveDialog).toHaveBeenLastCalledWith('/docs/work.pdfproject', 'project');
  });

  it('keeps recognised text, bookmarks and password protection of the source', async () => {
    const api = await setupApp();
    const user = userEvent.setup();
    mockViewportSize(1000, 700);
    render(<App />);
    api.dialogResults = [fakeFile('secret.pdf', '2:hunter2:outline')];
    run('file.open');
    await user.type(await screen.findByLabelText('Password'), 'hunter2');
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await screen.findByRole('tab', { name: 'secret.pdf' });
    const pageId = doc().pages[1]!.id;
    const recognised = { [pageId]: [{ text: 'Скан', x: 1, baseline: 2, angle: 0, width: 30, fontSize: 10, fontFamily: 'sans' as const }] };
    act(() => useDocumentsStore.getState().commit(doc().id, { recognised }));
    const bookmarks = doc().bookmarks;
    expect(bookmarks).toHaveLength(2);

    const data = await saveAsProject(api, '/docs/secret.pdfproject');
    await act(() => closeDocument(doc().id));

    // The project stores the protected file as it is, so the password is asked again.
    api.dialogResults = [projectFile('secret.pdfproject', data)];
    run('file.open');
    await user.type(await screen.findByLabelText('Password'), 'hunter2');
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await screen.findByRole('tab', { name: 'secret.pdfproject' });
    expect(doc().recognised).toEqual(recognised);
    expect(doc().bookmarks).toEqual(bookmarks);
    expect(doc().modified).toBe(false);
  });

  it('reports damaged, foreign and too-new project files without opening anything', async () => {
    const api = await setupApp();
    await openAndEdit(api);
    const data = await saveAsProject(api, '/docs/work.pdfproject');
    await act(() => closeDocument(doc().id));

    const entries = unzipSync(data);
    const manifest = JSON.parse(new TextDecoder().decode(entries['manifest.json'])) as Record<string, unknown>;
    const model = JSON.parse(new TextDecoder().decode(entries['document.json'])) as { pages: Array<{ source: { pageIndex: number } }> };
    const newer = zipSync({ ...entries, 'manifest.json': strToU8(JSON.stringify({ ...manifest, version: 99 })) });
    // A page pointing beyond the end of its source file.
    model.pages[0]!.source.pageIndex = 50;
    const outOfRange = zipSync({ ...entries, 'document.json': strToU8(JSON.stringify(model)) });

    api.dialogResults = [
      projectFile('newer.pdfproject', newer),
      projectFile('range.pdfproject', outOfRange),
      projectFile('truncated.pdfproject', data.subarray(0, data.length - 40)),
      projectFile('other.pdfproject', zipSync({ 'hello.txt': strToU8('hi') })),
    ];
    run('file.open');
    const notice = await screen.findByRole('dialog', { name: 'Some files could not be opened' });
    expect(notice).toHaveTextContent('newer.pdfproject: the project was saved by a newer version of the application');
    expect(notice).toHaveTextContent('range.pdfproject: the project file is damaged');
    expect(notice).toHaveTextContent('truncated.pdfproject: the file is not a PDF Editor project');
    expect(notice).toHaveTextContent('other.pdfproject: the file is not a PDF Editor project');
    expect(documents()).toHaveLength(0);
    expect(api.recentFiles.map((file) => file.path)).toEqual(['/docs/work.pdfproject', '/docs/report.pdf']);
  });
});

describe('autosave and recovery', () => {
  it('keeps a recovery copy of modified documents only, and drops it once they are saved', async () => {
    const api = await setupApp({ settings: { ...DEFAULT_SETTINGS, autosaveInterval: 30 } });
    mockViewportSize(1000, 700);
    render(<App />);
    await openFile(api, fakeFile('report.pdf', '3'), 'report.pdf');
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    // Re-render so the interval is created with the fake timers.
    act(() => useDocumentsStore.getState().updateView(doc().id, {}));

    await act(() => autosaveNow());
    expect(api.recoveryCopies.size).toBe(0);

    act(() => addObject(doc().id, doc().pages[0]!.id, createTextObject({ x: 1, y: 1 }, DEFAULT_TOOL_STYLE, 'draft')));
    await act(() => autosaveNow());
    expect([...api.recoveryCopies.keys()]).toEqual([doc().id]);
    expect(api.recoveryCopies.get(doc().id)).toMatchObject({ name: 'report.pdf', path: '/docs/report.pdf' });

    // Nothing changed since: no second write.
    await act(() => autosaveNow());
    expect(api.recovery.write).toHaveBeenCalledTimes(1);
    // The user's own file is never touched by autosave.
    expect(api.written).toHaveLength(0);

    run('file.save');
    await waitFor(() => expect(doc().modified).toBe(false));
    await waitFor(() => expect(api.recoveryCopies.size).toBe(0));
    vi.useRealTimers();
  });

  it('runs on the interval from the preferences and can be turned off', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const api = await setupApp({ settings: { ...DEFAULT_SETTINGS, autosaveInterval: 30 } });
    mockViewportSize(1000, 700);
    render(<App />);
    await openFile(api, fakeFile('report.pdf', '2'), 'report.pdf');
    act(() => addObject(doc().id, doc().pages[0]!.id, createTextObject({ x: 1, y: 1 }, DEFAULT_TOOL_STYLE, 'draft')));

    await act(() => vi.advanceTimersByTimeAsync(29_000));
    expect(api.recovery.write).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    await waitFor(() => expect(api.recovery.write).toHaveBeenCalledTimes(1));

    await act(() => api.settings.update({ autosaveInterval: 0 }).then(() => undefined));
    run('settings.preferences');
    const select = await screen.findByLabelText('Save a recovery copy of changed documents');
    expect(within(select).getByRole('option', { name: 'Never' })).toBeInTheDocument();
  });

  it('offers copies left by a crash and restores them as unsaved documents', async () => {
    // First session: edit, autosave, then "crash" (no save, no clean-up).
    const first = await setupApp();
    await openAndEdit(first);
    const edited = doc();
    await act(() => autosaveNow());
    const copy = first.recoveryCopies.get(edited.id)!;
    cleanup();

    // Second session.
    const api = await setupApp();
    api.recoveryCopies.set(copy.id, { ...copy, savedAt: Date.UTC(2026, 10, 10, 9, 30), leftOver: true });
    const user = userEvent.setup();
    mockViewportSize(1000, 700);
    render(<App />);
    const dialog = await screen.findByRole('dialog', { name: 'Recover unsaved documents' });
    expect(dialog).toHaveTextContent('report.pdf');
    expect(dialog).toHaveTextContent('/docs/report.pdf');

    await user.click(within(dialog).getByRole('button', { name: 'Restore: report.pdf' }));
    await screen.findByRole('tab', { name: /report\.pdf/ });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Recover unsaved documents' })).not.toBeInTheDocument());

    const restored = doc();
    expect(restored.modified).toBe(true);
    expect(restored.path).toBe('/docs/report.pdf');
    expect(restored.objects).toEqual(edited.objects);
    expect(restored.layers).toEqual(edited.layers);
    // The old copy is gone, and the restored document already has one of its own.
    expect([...api.recoveryCopies.keys()]).toEqual([restored.id]);
    expect(api.recoveryCopies.get(restored.id)?.leftOver).toBe(false);

    // Saving goes to the original file and clears the copy.
    run('file.save');
    await waitFor(() => expect(api.written.at(-1)?.path).toBe('/docs/report.pdf'));
    await waitFor(() => expect(api.recoveryCopies.size).toBe(0));
  });

  it('discards copies only after confirmation and can postpone the decision', async () => {
    const first = await setupApp();
    await openAndEdit(first);
    await act(() => autosaveNow());
    const copy = first.recoveryCopies.get(doc().id)!;
    cleanup();

    const api = await setupApp();
    api.recoveryCopies.set('a', { ...copy, id: 'a', name: 'one.pdf', leftOver: true });
    api.recoveryCopies.set('b', { ...copy, id: 'b', name: 'two.pdf', path: null, leftOver: true });
    const user = userEvent.setup();
    render(<App />);
    const dialog = await screen.findByRole('dialog', { name: 'Recover unsaved documents' });
    expect(dialog).toHaveTextContent('never saved to a file');

    await user.click(within(dialog).getByRole('button', { name: 'Discard: one.pdf' }));
    const confirm = await screen.findByRole('dialog', { name: 'Discard recovery copies?' });
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(api.recoveryCopies.size).toBe(2);

    await user.click(within(dialog).getByRole('button', { name: 'Discard: one.pdf' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Discard recovery copies?' })).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect([...api.recoveryCopies.keys()]).toEqual(['b']));

    // Postponing keeps the remaining copy on disk.
    await user.click(within(screen.getByRole('dialog', { name: 'Recover unsaved documents' })).getByRole('button', { name: 'Decide Later' }));
    expect(screen.queryByRole('dialog', { name: 'Recover unsaved documents' })).not.toBeInTheDocument();
    expect([...api.recoveryCopies.keys()]).toEqual(['b']);
    expect(documents()).toHaveLength(0);
  });
});

describe('files opened from the operating system', () => {
  it('opens what came with the launch and what arrives later', async () => {
    const api = await setupApp();
    api.openRequests = ['/docs/launch.pdf'];
    mockViewportSize(1000, 700);
    render(<App />);
    await screen.findByRole('tab', { name: 'launch.pdf' });
    expect(api.documents.openPaths).toHaveBeenCalledWith(['/docs/launch.pdf']);

    act(() => api.emitOpenRequest(['/docs/later.pdf']));
    await screen.findByRole('tab', { name: 'later.pdf' });
    expect(documents().map((document) => document.name)).toEqual(['launch.pdf', 'later.pdf']);
  });
});
