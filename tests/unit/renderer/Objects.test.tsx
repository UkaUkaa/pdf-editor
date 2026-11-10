import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { EditorObject, ShapeObject, TextObject } from '@shared/types/objects';
import { DEFAULT_TOOL_STYLE } from '@shared/types/objects';
import { App } from '@renderer/app/App';
import { createShapeObject, createTextObject } from '@renderer/engine/objects/factory';
import {
  addObject,
  finishTextEditing,
  insertImageFiles,
  replaceObjects,
  selectObjects,
  startTextEditing,
} from '@renderer/features/pdf-editor/objectActions';
import { computeCommandState, currentCommandContext, executeCommand } from '@renderer/services/commands';
import { getActiveDocument } from '@renderer/stores/documentsStore';
import { useToolStore } from '@renderer/stores/toolStore';
import { fakeFile, mockViewportSize, setupApp, type FakeApi } from './testUtils';

const run = (id: Parameters<typeof executeCommand>[0]): void => act(() => void executeCommand(id));
const enabled = (id: Parameters<typeof executeCommand>[0]): boolean =>
  computeCommandState(currentCommandContext()).enabled.includes(id);
const doc = () => getActiveDocument()!;
const pageId = (index = doc().view.currentPage): string => doc().pages[index]!.id;
const objects = (index?: number): EditorObject[] => doc().objects[pageId(index)] ?? [];
const rect = (x: number, y = 100): ShapeObject => createShapeObject('rect', { x, y }, { x: x + 50, y: y + 40 }, DEFAULT_TOOL_STYLE);
const add = (object: EditorObject, index?: number): void => act(() => addObject(doc().id, pageId(index), object));
const exported = (data: Uint8Array): { objects: EditorObject[][] } =>
  JSON.parse(new TextDecoder().decode(data).replace('%PDF-fake', '')) as { objects: EditorObject[][] };

describe('editing objects', () => {
  let api: FakeApi;

  beforeEach(async () => {
    mockViewportSize(1000, 700);
    api = await setupApp();
    render(<App />);
    api.dialogResults = [fakeFile('doc.pdf', '3')];
    run('file.open');
    await screen.findByRole('tab', { name: 'doc.pdf' });
  });

  it('adds objects to the page, draws them and records each as an undo step', async () => {
    add(rect(10));
    add(createTextObject({ x: 100, y: 200 }, DEFAULT_TOOL_STYLE, 'Привет'));
    const viewer = screen.getByRole('region', { name: 'Document view' });
    await waitFor(() => expect(viewer.querySelectorAll('.editor-object')).toHaveLength(2));
    expect(viewer.querySelector('.editor-object[data-object-type="text"]')).toHaveTextContent('Привет');
    // The newest object is selected and described in the properties panel.
    expect(screen.getByTestId('selection-summary')).toHaveTextContent('Text');
    expect(screen.getByTestId('document-status')).toHaveTextContent('Unsaved changes');
    // Thumbnails show the objects too.
    expect(screen.getByRole('option', { name: 'Page 1' }).querySelectorAll('.editor-object')).toHaveLength(2);

    run('edit.undo');
    expect(objects()).toHaveLength(1);
    run('edit.undo');
    expect(objects()).toHaveLength(0);
    expect(doc().modified).toBe(false);
    run('edit.redo');
    run('edit.redo');
    expect(objects().map((object) => object.type)).toEqual(['shape', 'text']);
  });

  it('edits properties from the panel and merges rapid changes into one undo step', async () => {
    add(rect(10));
    const panel = within(screen.getByRole('complementary', { name: 'Properties panel' }));
    const before = doc().history.past.length;

    const width = panel.getByLabelText('Stroke width');
    fireEvent.change(width, { target: { value: '5' } });
    fireEvent.change(width, { target: { value: '7' } });
    fireEvent.change(width, { target: { value: '9' } });
    expect((objects()[0] as ShapeObject).strokeWidth).toBe(9);
    expect(doc().history.past.length).toBe(before + 1);

    fireEvent.change(panel.getByLabelText('X'), { target: { value: '250' } });
    fireEvent.change(panel.getByLabelText('Rotation'), { target: { value: '45' } });
    fireEvent.change(panel.getByLabelText('Opacity, %'), { target: { value: '50' } });
    expect(objects()[0]).toMatchObject({ x: 250, rotation: 45, opacity: 0.5 });

    // Fill is optional: switching it on applies a colour, switching it off removes it.
    const fill = panel.getByRole('checkbox', { name: 'Fill' });
    fireEvent.click(fill);
    expect((objects()[0] as ShapeObject).fill).toBe('#ffe14d');
    fireEvent.click(fill);
    expect((objects()[0] as ShapeObject).fill).toBeNull();
    fireEvent.click(panel.getByRole('checkbox', { name: 'Dashed line' }));
    expect((objects()[0] as ShapeObject).dashed).toBe(true);

    // Out-of-range and empty input never reaches the document.
    fireEvent.change(width, { target: { value: '' } });
    fireEvent.change(width, { target: { value: '9999' } });
    expect((objects()[0] as ShapeObject).strokeWidth).toBe(100);

    run('edit.undo');
    expect((objects()[0] as ShapeObject).strokeWidth).toBe(9);
  });

  it('formats text and keeps the box height in step with its lines', async () => {
    const user = userEvent.setup();
    add({ ...createTextObject({ x: 50, y: 50 }, DEFAULT_TOOL_STYLE, 'one two three four five six seven'), width: 80 });
    const text = (): TextObject => objects()[0] as TextObject;
    const wrappedHeight = text().height;
    expect(wrappedHeight).toBeGreaterThan(text().fontSize * 2);

    const panel = within(screen.getByRole('complementary', { name: 'Properties panel' }));
    await user.click(panel.getByRole('button', { name: 'Bold' }));
    await user.click(panel.getByRole('button', { name: 'Italic' }));
    await user.click(panel.getByRole('button', { name: 'Align center' }));
    await user.selectOptions(panel.getByLabelText('Font'), 'serif');
    fireEvent.change(panel.getByLabelText('Size'), { target: { value: '28' } });
    expect(text()).toMatchObject({ bold: true, italic: true, align: 'center', fontFamily: 'serif', fontSize: 28 });
    expect(text().height).toBeGreaterThan(wrappedHeight);

    fireEvent.change(panel.getByLabelText('Width'), { target: { value: '2000' } });
    expect(text().height).toBeCloseTo(28 * 1.2 + 4);
  });

  it('types text through the inline editor, commits on finish and removes text left empty', async () => {
    const created = createTextObject({ x: 50, y: 50 }, DEFAULT_TOOL_STYLE);
    add(created);
    act(() => startTextEditing(doc().id, pageId(), created));
    const editor = await screen.findByRole('textbox', { name: '' });
    fireEvent.change(editor, { target: { value: 'Набранный текст' } });
    // Typing is not part of the document until the editor is left.
    expect((objects()[0] as TextObject).text).toBe('');
    act(() => finishTextEditing());
    expect((objects()[0] as TextObject).text).toBe('Набранный текст');
    expect(useToolStore.getState().editing).toBeNull();

    const empty = createTextObject({ x: 50, y: 150 }, DEFAULT_TOOL_STYLE);
    add(empty);
    act(() => startTextEditing(doc().id, pageId(), empty));
    act(() => finishTextEditing());
    expect(objects()).toHaveLength(1);

    // Switching tools while typing must not lose the text.
    act(() => startTextEditing(doc().id, pageId(), objects()[0] as TextObject));
    act(() => useToolStore.getState().setEditingText('Изменено'));
    run('tools.draw');
    expect((objects()[0] as TextObject).text).toBe('Изменено');
  });

  it('copies, cuts, pastes, duplicates, selects all and deletes', async () => {
    add(rect(10));
    add(rect(200));
    expect(enabled('edit.paste')).toBe(true);
    run('edit.copy');
    run('edit.paste');
    expect(objects()).toHaveLength(3);
    expect(objects()[2]).toMatchObject({ x: 212, y: 112 });
    expect(doc().selectedObjects).toEqual([objects()[2]!.id]);
    run('edit.paste');
    expect(objects()[3]).toMatchObject({ x: 224, y: 124 });

    run('edit.selectAll');
    expect(doc().selectedObjects).toHaveLength(4);
    run('edit.duplicate');
    expect(objects()).toHaveLength(8);
    run('edit.cut');
    expect(objects()).toHaveLength(4);
    run('edit.selectAll');
    run('edit.delete');
    expect(objects()).toHaveLength(0);
    expect(enabled('edit.delete')).toBe(false);

    // Pasting works on another page as well.
    run('view.nextPage');
    run('edit.paste');
    expect(objects(1)).toHaveLength(4);
  });

  it('reorders and aligns the selection', async () => {
    add(rect(10, 100));
    add(rect(200, 300));
    add(rect(400, 500));
    const ids = objects().map((object) => object.id);

    act(() => selectObjects(doc().id, [ids[0]!]));
    run('arrange.bringToFront');
    expect(objects().map((object) => object.id)).toEqual([ids[1], ids[2], ids[0]]);
    run('arrange.sendBackward');
    expect(objects().map((object) => object.id)).toEqual([ids[1], ids[0], ids[2]]);
    expect(enabled('arrange.distributeHorizontal')).toBe(false);

    run('arrange.alignLeft');
    expect(objects().find((object) => object.id === ids[0])!.x).toBe(0);

    run('edit.selectAll');
    run('arrange.alignTop');
    expect(new Set(objects().map((object) => object.y)).size).toBe(1);
    expect(enabled('arrange.distributeHorizontal')).toBe(true);
    run('arrange.distributeHorizontal');
    const xs = objects().map((object) => object.x).sort((a, b) => a - b);
    expect(xs[1]! - xs[0]!).toBeCloseTo(xs[2]! - xs[1]!);
  });

  it('switches tools, shows them as active and shows the defaults for new objects', async () => {
    const user = userEvent.setup();
    const toolbar = within(screen.getByRole('toolbar'));
    expect(toolbar.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(toolbar.getByRole('button', { name: 'Draw' }));
    expect(useToolStore.getState().tool).toBe('draw');
    expect(screen.getByTestId('status-tool')).toHaveTextContent('Draw');
    const panel = within(screen.getByRole('complementary', { name: 'Properties panel' }));
    fireEvent.change(panel.getByLabelText('Stroke width'), { target: { value: '6' } });
    expect(useToolStore.getState().style.strokeWidth).toBe(6);

    await user.click(toolbar.getByRole('button', { name: 'Shapes' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Ellipse' }));
    expect(useToolStore.getState().tool).toBe('ellipse');
    expect(toolbar.getByRole('button', { name: 'Shapes' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.keyDown(screen.getByRole('region', { name: 'Document view' }), { key: 'Escape' });
    expect(useToolStore.getState().tool).toBe('select');
  });

  it('moves and deletes the selection from the keyboard', async () => {
    add(rect(100, 100));
    const viewer = screen.getByRole('region', { name: 'Document view' });
    const before = doc().history.past.length;
    fireEvent.keyDown(viewer, { key: 'ArrowRight' });
    fireEvent.keyDown(viewer, { key: 'ArrowRight' });
    fireEvent.keyDown(viewer, { key: 'ArrowDown', shiftKey: true });
    expect(objects()[0]).toMatchObject({ x: 102, y: 110 });
    expect(doc().history.past.length).toBe(before + 1);
    fireEvent.keyDown(viewer, { key: 'Escape' });
    expect(doc().selectedObjects).toEqual([]);
    act(() => selectObjects(doc().id, [objects()[0]!.id]));
    fireEvent.keyDown(viewer, { key: 'Delete' });
    expect(objects()).toHaveLength(0);
  });

  it('inserts images as objects sized to the page and reports unreadable ones', async () => {
    api.imageResults = [
      { ok: true, file: { path: '/img/photo.png', name: 'photo.png', size: 3, data: new Uint8Array([1, 2, 3]) } },
      { ok: true, file: { path: '/img/bad.png', name: 'bad.png', size: 1, data: new Uint8Array([0]) } },
    ];
    run('insert.image');
    const notice = await screen.findByRole('dialog', { name: 'Some files could not be opened' });
    expect(notice).toHaveTextContent('bad.png: the image could not be decoded');
    expect(objects()).toHaveLength(1);
    // 400x200 px fits unscaled; centred on the 595x842 page.
    expect(objects()[0]).toMatchObject({ type: 'image', width: 357, height: 178.5 });
    expect(doc().resourceIds).toHaveLength(2);

    await act(() => insertImageFiles([new File([new Uint8Array([1])], 'pasted.png', { type: 'image/png' })]));
    expect(objects()).toHaveLength(2);
  });

  it('offers lines of original text for replacement and marks the result as an overlay', async () => {
    run('tools.editText');
    const viewer = screen.getByRole('region', { name: 'Document view' });
    await waitFor(() => expect(viewer.querySelectorAll('.text-run').length).toBeGreaterThan(0));
    expect(screen.getByText(/The original is covered, not removed from the file/)).toBeInTheDocument();

    const line = viewer.querySelector('.text-run[data-text-run="Original line"]')!;
    fireEvent.pointerDown(line, { button: 0 });
    await waitFor(() => expect(objects()).toHaveLength(1));
    const replacement = objects()[0] as TextObject;
    expect(replacement).toMatchObject({
      type: 'text',
      text: 'Original line',
      fontSize: 12,
      fontFamily: 'serif',
      replacesOriginal: true,
      background: '#ffffff',
      color: '#000000',
    });
    // The new baseline coincides with the original one (run baseline 100pt from the top).
    const baseline = replacement.y + 2 + (12 * 1.3 - 12) / 2 + 12 * (1901 / 2048);
    expect(baseline).toBeCloseTo(100, 6);
    expect(replacement.x).toBe(48);

    // The editor opens on the replacement; the tool returns to selection.
    expect(useToolStore.getState()).toMatchObject({ tool: 'select', editing: { objectId: replacement.id } });
    act(() => useToolStore.getState().setEditingText('A much longer replacement line than before'));
    act(() => finishTextEditing());
    const edited = objects()[0] as TextObject;
    expect(edited.text).toBe('A much longer replacement line than before');
    expect(edited.width).toBeGreaterThan(replacement.width);
    expect(screen.getByText(/Overlay replacement/)).toBeInTheDocument();

    // A replaced line is no longer offered; the other one still is.
    run('tools.editText');
    const firstPage = viewer.querySelector('.viewer__page[data-page-number="1"]')!;
    await waitFor(() => expect(firstPage.querySelector('.text-run[data-text-run="Second line"]')).not.toBeNull());
    expect(firstPage.querySelector('.text-run[data-text-run="Original line"]')).toBeNull();
  });

  it('saves objects with their pages and keeps them attached through page operations', async () => {
    add(rect(10));
    run('view.nextPage');
    add(createTextObject({ x: 5, y: 5 }, DEFAULT_TOOL_STYLE, 'page two'));

    // Duplicating a page copies its objects (with new ids); deleting a page removes them.
    run('pages.duplicate');
    expect(doc().pages).toHaveLength(4);
    expect(objects(2)).toHaveLength(1);
    expect(objects(2)[0]!.id).not.toBe(objects(1)[0]!.id);
    run('pages.reverse');

    run('file.save');
    await waitFor(() => expect(api.written).toHaveLength(1));
    const saved = exported(api.written[0]!.data).objects;
    expect(saved.map((list) => list.map((object) => object.type))).toEqual([[], ['text'], ['text'], ['shape']]);
    await waitFor(() => expect(doc().modified).toBe(false));

    // Moving an object makes the document modified again; undo returns to the saved state.
    const shapePage = doc().pages.findIndex((page) => (doc().objects[page.id] ?? []).some((object) => object.type === 'shape'));
    const target = doc().objects[doc().pages[shapePage]!.id]![0]!;
    act(() => replaceObjects(doc().id, doc().pages[shapePage]!.id, [{ ...target, x: 300 }]));
    expect(doc().modified).toBe(true);
    run('edit.undo');
    expect(doc().modified).toBe(false);
  });
});
