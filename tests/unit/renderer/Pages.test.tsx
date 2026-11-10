import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_HISTORY_DEPTH, type PageSource } from '@shared/types/document';
import { App } from '@renderer/app/App';
import { hasResource } from '@renderer/engine/rendering/pageRenderer';
import { movePagesTo } from '@renderer/features/pages/pageActions';
import { computeCommandState, currentCommandContext, executeCommand } from '@renderer/services/commands';
import { getActiveDocument, useDocumentsStore } from '@renderer/stores/documentsStore';
import { fakeFile, mockViewportSize, setupApp, type FakeApi } from './testUtils';

/** Source page numbers (1-based) of the active document, in order; "B" = blank, "I" = image. */
const order = (): string =>
  getActiveDocument()!
    .pages.map(({ source }) => (source.kind === 'pdf' ? source.pageIndex + 1 : source.kind === 'blank' ? 'B' : 'I'))
    .join(' ');
const rotations = (): number[] => getActiveDocument()!.pages.map((page) => page.rotation);
const run = (id: Parameters<typeof executeCommand>[0]): void => act(() => void executeCommand(id));
const enabled = (id: Parameters<typeof executeCommand>[0]): boolean =>
  computeCommandState(currentCommandContext()).enabled.includes(id);
const thumbnail = (number: number): HTMLElement => screen.getByRole('option', { name: `Page ${number}` });
/** Pages the fake exporter wrote: [source, rotation] pairs. */
const exported = (data: Uint8Array): Array<[PageSource, number]> =>
  (JSON.parse(new TextDecoder().decode(data).replace('%PDF-fake', '')) as { pages: Array<[PageSource, number]> }).pages;
const exportedOrder = (data: Uint8Array): string =>
  exported(data)
    .map(([source]) => (source.kind === 'pdf' ? source.pageIndex + 1 : source.kind === 'blank' ? 'B' : 'I'))
    .join(' ');

async function confirmDialog(name: string, button: string): Promise<void> {
  const dialog = await screen.findByRole('dialog', { name });
  await userEvent.setup().click(within(dialog).getByRole('button', { name: button }));
}

describe('page management', () => {
  let api: FakeApi;

  beforeEach(async () => {
    mockViewportSize(1000, 700);
    api = await setupApp();
    render(<App />);
    api.dialogResults = [fakeFile('doc.pdf', '5')];
    run('file.open');
    await screen.findByRole('tab', { name: 'doc.pdf' });
  });

  it('rotates, duplicates, adds and reorders pages, each as one undoable step', async () => {
    run('pages.rotateCw');
    expect(rotations()).toEqual([90, 0, 0, 0, 0]);
    run('pages.rotateCcw');
    run('pages.rotateCcw');
    expect(rotations()[0]).toBe(270);

    run('pages.duplicate');
    expect(order()).toBe('1 1 2 3 4 5');
    // The copy becomes the selected, current page and keeps the rotation.
    expect(getActiveDocument()!.view.currentPage).toBe(1);
    expect(rotations().slice(0, 2)).toEqual([270, 270]);

    run('pages.addBlank');
    expect(order()).toBe('1 1 B 2 3 4 5');
    // The blank page takes the size of the page it follows, as displayed (rotated).
    expect(getActiveDocument()!.pages[2]!.box).toMatchObject({ width: 842, height: 595 });

    run('pages.moveDown');
    expect(order()).toBe('1 1 2 B 3 4 5');
    run('pages.moveUp');
    run('pages.moveUp');
    expect(order()).toBe('1 B 1 2 3 4 5');
    run('pages.reverse');
    expect(order()).toBe('5 4 3 2 1 B 1');

    expect(screen.getByTestId('document-status')).toHaveTextContent('Unsaved changes');
    expect(screen.getByRole('tab', { name: /doc\.pdf/ })).toHaveTextContent('•');
    expect(api.app.setDirty).toHaveBeenLastCalledWith(true);

    // Undo everything, step by step, back to the pristine document.
    const steps = getActiveDocument()!.history.past.length;
    expect(steps).toBe(9);
    for (let step = 0; step < steps; step += 1) run('edit.undo');
    expect(order()).toBe('1 2 3 4 5');
    expect(rotations()).toEqual([0, 0, 0, 0, 0]);
    expect(enabled('edit.undo')).toBe(false);
    expect(screen.getByTestId('document-status')).toHaveTextContent('No changes');
    expect(api.app.setDirty).toHaveBeenLastCalledWith(false);

    // Redo restores every step; a new change then discards the redo stack.
    for (let step = 0; step < steps; step += 1) run('edit.redo');
    expect(order()).toBe('5 4 3 2 1 B 1');
    run('edit.undo');
    run('pages.rotateCw');
    expect(enabled('edit.redo')).toBe(false);
  });

  it('selects with click, Ctrl-click, Shift-click and Ctrl+A, and applies commands to the selection', async () => {
    const user = userEvent.setup();
    await user.click(thumbnail(2));
    expect(thumbnail(2)).toHaveAttribute('aria-selected', 'true');
    expect(thumbnail(2)).toHaveAttribute('aria-current', 'page');

    await user.keyboard('{Control>}');
    await user.click(thumbnail(4));
    await user.keyboard('{/Control}');
    expect(getActiveDocument()!.selection).toHaveLength(2);

    run('pages.rotateCw');
    expect(rotations()).toEqual([0, 90, 0, 90, 0]);

    // Shift-click selects the range from the current page (4) to the clicked one.
    await user.keyboard('{Shift>}');
    await user.click(thumbnail(2));
    await user.keyboard('{/Shift}');
    expect([2, 3, 4].every((number) => thumbnail(number).getAttribute('aria-selected') === 'true')).toBe(true);
    expect(thumbnail(1)).toHaveAttribute('aria-selected', 'false');
    run('pages.moveDown');
    expect(order()).toBe('1 5 2 3 4');

    const list = screen.getByRole('listbox', { name: 'Page thumbnails' });
    fireEvent.keyDown(list, { key: 'a', ctrlKey: true });
    expect(getActiveDocument()!.selection).toHaveLength(5);
    // Everything is selected, so nothing can be deleted or moved.
    expect(enabled('pages.delete')).toBe(false);
    expect(enabled('pages.moveUp')).toBe(false);
    fireEvent.keyDown(list, { key: 'Escape' });
    expect(getActiveDocument()!.selection).toHaveLength(0);
  });

  it('asks before deleting, keeps at least one page and can undo the deletion', async () => {
    const user = userEvent.setup();
    await user.click(thumbnail(2));
    await user.keyboard('{Control>}');
    await user.click(thumbnail(3));
    await user.keyboard('{/Control}');

    fireEvent.keyDown(screen.getByRole('listbox', { name: 'Page thumbnails' }), { key: 'Delete' });
    const dialog = await screen.findByRole('dialog', { name: 'Delete pages' });
    expect(dialog).toHaveTextContent('(2)');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(order()).toBe('1 2 3 4 5');

    run('pages.delete');
    await confirmDialog('Delete pages', 'Delete');
    await waitFor(() => expect(order()).toBe('1 4 5'));
    expect(screen.getByTestId('status-page')).toHaveTextContent('/ 3');

    run('edit.undo');
    expect(order()).toBe('1 2 3 4 5');
    expect(getActiveDocument()!.selection).toHaveLength(2);
  });

  it('reorders by drag and drop and ignores drops that change nothing', async () => {
    const user = userEvent.setup();
    await user.click(thumbnail(1));
    const pages = getActiveDocument()!.pages;
    act(() => movePagesTo(getActiveDocument()!.id, [pages[0]!.id], 1));
    expect(getActiveDocument()!.history.past).toHaveLength(0);

    // Real drag events on the thumbnails: drag page 1 below the last page.
    const transfer = { types: [] as string[], data: {} as Record<string, string>, effectAllowed: '', dropEffect: '',
      setData(type: string, value: string) { this.types.push(type); this.data[type] = value; } };
    fireEvent.dragStart(thumbnail(1), { dataTransfer: transfer });
    const list = screen.getByRole('listbox', { name: 'Page thumbnails' });
    fireEvent.dragOver(list, { dataTransfer: transfer, clientY: 5000 });
    expect(list.querySelector('.thumbnails__drop-indicator')).not.toBeNull();
    fireEvent.drop(list, { dataTransfer: transfer, clientY: 5000 });
    expect(order()).toBe('2 3 4 5 1');
    expect(list.querySelector('.thumbnails__drop-indicator')).toBeNull();

    // A drag that does not carry pages (e.g. a file from the OS) is not a reorder.
    fireEvent.drop(list, { dataTransfer: { types: ['Files'] }, clientY: 0 });
    expect(order()).toBe('2 3 4 5 1');
  });

  it('offers page commands in the thumbnail context menu', async () => {
    const user = userEvent.setup();
    fireEvent.contextMenu(thumbnail(3), { clientX: 50, clientY: 60 });
    const menu = await screen.findByRole('menu', { name: 'Pages' });
    expect(thumbnail(3)).toHaveAttribute('aria-selected', 'true');
    await user.click(within(menu).getByRole('menuitem', { name: /Rotate Clockwise/ }));
    expect(rotations()).toEqual([0, 0, 90, 0, 0]);
    expect(screen.queryByRole('menu', { name: 'Pages' })).not.toBeInTheDocument();
  });

  it('inserts pages from another PDF and from images after the selection', async () => {
    const user = userEvent.setup();
    await user.click(thumbnail(2));
    api.dialogResults = [fakeFile('other.pdf', '2'), fakeFile('broken.pdf', 'corrupt')];
    run('pages.insertFromPdf');
    await confirmDialog('Some files could not be opened', 'OK');
    expect(order()).toBe('1 2 1 2 3 4 5');
    const document = getActiveDocument()!;
    expect(document.resourceIds).toHaveLength(2);
    expect(document.selection).toHaveLength(2);

    api.imageResults = [
      { ok: true, file: { path: '/img/photo.png', name: 'photo.png', size: 3, data: new Uint8Array([1, 2, 3]) } },
      { ok: true, file: { path: '/img/bad.png', name: 'bad.png', size: 1, data: new Uint8Array([0]) } },
      { ok: false, path: '/img/x.tiff', name: 'x.tiff', error: 'notImage' },
    ];
    run('pages.importImages');
    const notice = await screen.findByRole('dialog', { name: 'Some files could not be opened' });
    expect(notice).toHaveTextContent('bad.png: the image could not be decoded');
    expect(notice).toHaveTextContent('x.tiff: not a supported image');
    expect(order()).toBe('1 2 1 2 I 3 4 5');
    // 400x200 image: landscape page as wide as A4 is tall.
    expect(getActiveDocument()!.pages[4]!.box.width).toBeCloseTo(841.89);

    // One undo removes the whole insertion.
    run('edit.undo');
    run('edit.undo');
    expect(order()).toBe('1 2 3 4 5');
  });

  it('merges files into a new unsaved document', async () => {
    api.dialogResults = [fakeFile('a.pdf', '2'), fakeFile('b.pdf', '3')];
    run('pages.merge');
    await screen.findByRole('tab', { name: /Untitled\.pdf/ });
    expect(order()).toBe('1 2 1 2 3');
    expect(getActiveDocument()).toMatchObject({ path: null, modified: true });
    expect(useDocumentsStore.getState().documents).toHaveLength(2);
  });

  it('saves to the original file, clears the modified state and keeps undo working', async () => {
    expect(enabled('file.save')).toBe(false);
    run('pages.reverse');
    run('pages.rotateCw');
    expect(enabled('file.save')).toBe(true);

    run('file.save');
    await waitFor(() => expect(api.written).toHaveLength(1));
    expect(api.written[0]!.path).toBe('/docs/doc.pdf');
    expect(exportedOrder(api.written[0]!.data)).toBe('5 4 3 2 1');
    // The current page (source page 1) followed the reversal to the end and was the one rotated.
    expect(exported(api.written[0]!.data).map(([, rotation]) => rotation)).toEqual([0, 0, 0, 0, 90]);
    await waitFor(() => expect(getActiveDocument()!.modified).toBe(false));
    expect(enabled('file.save')).toBe(false);

    // Undoing past the save point makes the document modified again.
    run('edit.undo');
    expect(getActiveDocument()!.modified).toBe(true);
    run('edit.redo');
    expect(getActiveDocument()!.modified).toBe(false);
  });

  it('Save As adopts the new path; Save a Copy and Extract do not', async () => {
    api.savePath = '/out/renamed.pdf';
    run('file.saveAs');
    expect(await screen.findByRole('tab', { name: 'renamed.pdf' })).toBeInTheDocument();
    expect(getActiveDocument()!.path).toBe('/out/renamed.pdf');
    expect(api.recentFiles[0]?.path).toBe('/out/renamed.pdf');

    api.savePath = '/out/copy.pdf';
    run('pages.rotateCw');
    run('file.saveCopy');
    await waitFor(() => expect(api.written).toHaveLength(2));
    expect(getActiveDocument()).toMatchObject({ path: '/out/renamed.pdf', modified: true });

    const user = userEvent.setup();
    await user.click(thumbnail(2));
    await user.keyboard('{Control>}');
    await user.click(thumbnail(5));
    await user.keyboard('{/Control}');
    api.savePath = '/out/part.pdf';
    run('pages.extract');
    await waitFor(() => expect(api.written).toHaveLength(3));
    expect(api.written[2]!.path).toBe('/out/part.pdf');
    expect(exportedOrder(api.written[2]!.data)).toBe('2 5');
    expect(order()).toBe('1 2 3 4 5');

    // Cancelling the save dialog writes nothing.
    api.savePath = null;
    run('file.saveAs');
    await act(async () => undefined);
    expect(api.written).toHaveLength(3);
  });

  it('reports a failed save and leaves the document modified', async () => {
    run('pages.reverse');
    api.writeResult = { ok: false, error: 'writeFailed' };
    run('file.save');
    const dialog = await screen.findByRole('dialog', { name: 'The file could not be saved' });
    expect(dialog).toHaveTextContent('doc.pdf: the file could not be written to disk');
    expect(getActiveDocument()!.modified).toBe(true);
  });

  it('splits the document into files of N pages', async () => {
    const user = userEvent.setup();
    api.directory = '/out/parts';
    run('pages.split');
    const dialog = await screen.findByRole('dialog', { name: 'Split document' });
    const input = within(dialog).getByLabelText('Pages per file');
    await user.clear(input);
    await user.type(input, '9');
    expect(within(dialog).getByRole('button', { name: 'Choose Folder and Split' })).toBeDisabled();
    await user.clear(input);
    await user.type(input, '2');
    expect(dialog).toHaveTextContent('Files to be created: 3');
    await user.click(within(dialog).getByRole('button', { name: 'Choose Folder and Split' }));

    const done = await screen.findByRole('dialog', { name: 'Document split' });
    expect(done).toHaveTextContent('Files created: 3');
    expect(api.written.map((file) => file.path)).toEqual(['/out/parts/doc-1.pdf', '/out/parts/doc-2.pdf', '/out/parts/doc-3.pdf']);
    expect(api.written.map((file) => exportedOrder(file.data))).toEqual(['1 2', '3 4', '5']);
    expect(getActiveDocument()!.modified).toBe(false);
  });

  it('asks before closing a modified document: cancel, save or discard', async () => {
    const user = userEvent.setup();
    const resource = getActiveDocument()!.resourceIds[0]!;
    run('pages.reverse');

    await user.click(screen.getByRole('button', { name: 'Close doc.pdf' }));
    await confirmDialog('Unsaved changes', 'Cancel');
    expect(screen.getByRole('tab', { name: /doc\.pdf/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close doc.pdf' }));
    await confirmDialog('Unsaved changes', 'Save');
    await waitFor(() => expect(screen.queryByRole('tab', { name: /doc\.pdf/ })).not.toBeInTheDocument());
    expect(api.written).toHaveLength(1);
    expect(hasResource(resource)).toBe(false);

    run('file.new');
    expect(getActiveDocument()).toMatchObject({ name: 'Untitled.pdf', modified: false });
    run('pages.addBlank');
    run('file.close');
    await confirmDialog('Unsaved changes', "Don't Save");
    await waitFor(() => expect(useDocumentsStore.getState().documents).toHaveLength(0));
    expect(api.written).toHaveLength(1);
  });

  it('routes undo to a focused text field instead of the document', async () => {
    const user = userEvent.setup();
    run('pages.reverse');
    await user.click(within(screen.getByRole('toolbar')).getByRole('textbox', { name: 'Page number' }));
    run('edit.undo');
    expect(api.app.performRole).toHaveBeenCalledWith('undo');
    expect(order()).toBe('5 4 3 2 1');

    act(() => (document.activeElement as HTMLElement).blur());
    run('edit.undo');
    expect(order()).toBe('1 2 3 4 5');
  });

  it('limits the undo history depth', () => {
    for (let step = 0; step < MAX_HISTORY_DEPTH + 20; step += 1) run('pages.rotateCw');
    expect(getActiveDocument()!.history.past).toHaveLength(MAX_HISTORY_DEPTH);
  });
});

describe('selection follows the current page', () => {
  it('drops a selection the user has navigated away from', async () => {
    mockViewportSize(1000, 700);
    const api = await setupApp();
    render(<App />);
    api.dialogResults = [fakeFile('doc.pdf', '6')];
    run('file.open');
    await screen.findByRole('tab', { name: 'doc.pdf' });
    const user = userEvent.setup();

    await user.click(thumbnail(2));
    await user.keyboard('{Shift>}');
    await user.click(thumbnail(3));
    await user.keyboard('{/Shift}');
    expect(getActiveDocument()!.selection).toHaveLength(2);

    // Moving inside the selection keeps it; leaving it clears it, so the next
    // command acts on the page the user is actually looking at.
    run('view.nextPage');
    expect(getActiveDocument()!.selection).toHaveLength(2);
    run('view.lastPage');
    expect(getActiveDocument()!.selection).toHaveLength(0);
    run('pages.rotateCw');
    expect(rotations()).toEqual([0, 0, 0, 0, 0, 90]);
  });
});
