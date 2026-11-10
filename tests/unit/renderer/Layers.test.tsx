import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Layer } from '@shared/types/layers';
import type { EditorObject } from '@shared/types/objects';
import { DEFAULT_TOOL_STYLE } from '@shared/types/objects';
import { App } from '@renderer/app/App';
import { createShapeObject, createTextObject } from '@renderer/engine/objects/factory';
import { layerContext, moveLayerTo, setActiveLayer } from '@renderer/features/layers/layerActions';
import { addObject, selectObjects } from '@renderer/features/pdf-editor/objectActions';
import { computeCommandState, currentCommandContext, executeCommand } from '@renderer/services/commands';
import { getActiveDocument } from '@renderer/stores/documentsStore';
import { fakeFile, mockViewportSize, setupApp, type FakeApi } from './testUtils';

const run = (id: Parameters<typeof executeCommand>[0]): void => act(() => void executeCommand(id));
const enabled = (id: Parameters<typeof executeCommand>[0]): boolean =>
  computeCommandState(currentCommandContext()).enabled.includes(id);
const doc = () => getActiveDocument()!;
const pageId = (index = doc().view.currentPage): string => doc().pages[index]!.id;
const layers = (index?: number): Layer[] => doc().layers[pageId(index)] ?? [];
const objects = (index?: number): EditorObject[] => doc().objects[pageId(index)] ?? [];
/** Layer names as the panel lists them: top-most first. */
const stack = (): string[] => [...layers()].reverse().map((layer) => layer.name);
const rect = (x: number): EditorObject => createShapeObject('rect', { x, y: 100 }, { x: x + 50, y: 140 }, DEFAULT_TOOL_STYLE);
const text = (value: string): EditorObject => createTextObject({ x: 10, y: 10 }, DEFAULT_TOOL_STYLE, value);
const add = (object: EditorObject): void => act(() => addObject(doc().id, pageId(), object));
const layerRow = (name: string): HTMLElement => {
  const row = [...document.querySelectorAll<HTMLElement>('.layers .layer')].find(
    (candidate) => candidate.querySelector('.layer__name')?.textContent === name,
  );
  if (!row) throw new Error(`No layer named "${name}" in the panel`);
  return row;
};
const viewer = (): HTMLElement => screen.getByRole('region', { name: 'Document view' });
/** Ids of the objects painted on the first page, bottom to top. */
const painted = (): string[] =>
  [...viewer().querySelectorAll('.viewer__page[data-page-number="1"] .editor-object')].map((element) => (element as HTMLElement).dataset['objectId']!);

describe('layers', () => {
  let api: FakeApi;

  beforeEach(async () => {
    mockViewportSize(1000, 700);
    api = await setupApp();
    render(<App />);
    api.dialogResults = [fakeFile('doc.pdf', '2')];
    run('file.open');
    await screen.findByRole('tab', { name: 'doc.pdf' });
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Layers' }));
  });

  it('starts empty and puts new objects on layers of their type', async () => {
    expect(screen.getByText(/This page has no layers yet/)).toBeInTheDocument();
    expect(screen.getByText('Original page content')).toBeInTheDocument();
    expect(enabled('layers.delete')).toBe(false);

    add(rect(10));
    add(text('note'));
    add(rect(100));
    expect(stack()).toEqual(['Text', 'Shapes']);
    expect(objects().map((object) => layers().find((layer) => layer.id === object.layerId)!.name)).toEqual(['Shapes', 'Text', 'Shapes']);
    // Counts in the panel.
    expect(within(layerRow('Shapes')).getByTitle('Objects on the layer')).toHaveTextContent('2');
    expect(within(layerRow('Text')).getByTitle('Objects on the layer')).toHaveTextContent('1');
    // Creating the layer and adding the object is a single undo step.
    run('edit.undo');
    expect(objects()).toHaveLength(2);
    run('edit.undo');
    expect(stack()).toEqual(['Shapes']);
  });

  it('adds, renames, reorders, duplicates and merges layers', async () => {
    const user = userEvent.setup();
    add(rect(10));
    run('layers.new');
    expect(stack()).toEqual(['Layer', 'Shapes']);
    // The new layer is active, so the next object goes there whatever its type.
    add(text('on the new layer'));
    expect(objects()[1]!.layerId).toBe(layers()[1]!.id);

    // Rename by double-click.
    await user.dblClick(within(layerRow('Layer')).getByRole('button', { name: 'Layer' }));
    const input = screen.getByRole('textbox', { name: 'Rename Layer' });
    await user.clear(input);
    await user.type(input, 'Заметки{Enter}');
    expect(stack()).toEqual(['Заметки', 'Shapes']);
    // Escape cancels a rename; an empty name is ignored.
    run('layers.rename');
    await user.type(screen.getByRole('textbox', { name: 'Rename Layer' }), 'x{Escape}');
    expect(stack()).toEqual(['Заметки', 'Shapes']);

    // Painting order follows the stack: move the active (top) layer below the other one.
    const [shapeId, textId] = objects().map((object) => object.id);
    expect(painted()).toEqual([shapeId, textId]);
    run('layers.moveDown');
    expect(stack()).toEqual(['Shapes', 'Заметки']);
    expect(painted()).toEqual([textId, shapeId]);
    expect(enabled('layers.moveDown')).toBe(false);
    run('layers.moveUp');
    act(() => moveLayerTo(layers()[0]!.id, 1));
    expect(stack()).toEqual(['Shapes', 'Заметки']);

    // Duplicate copies the layer with its objects, above the original.
    act(() => setActiveLayer(layers().find((layer) => layer.name === 'Shapes')!.id));
    run('layers.duplicate');
    expect(stack()).toEqual(['Shapes copy', 'Shapes', 'Заметки']);
    expect(objects()).toHaveLength(3);

    // Merge the copy down into the original.
    run('layers.merge');
    expect(stack()).toEqual(['Shapes', 'Заметки']);
    expect(objects().filter((object) => object.layerId === layers()[1]!.id)).toHaveLength(2);
    run('edit.undo');
    expect(stack()).toEqual(['Shapes copy', 'Shapes', 'Заметки']);
  });

  it('hides, locks and fades layers', async () => {
    const user = userEvent.setup();
    add(rect(10));
    add(text('note'));
    const [shapeId, textId] = objects().map((object) => object.id);
    act(() => selectObjects(doc().id, [textId!]));

    // Hidden: not painted on the page or in the thumbnail, and no longer selected.
    await user.click(within(layerRow('Text')).getByRole('button', { name: 'Layer visible' }));
    expect(painted()).toEqual([shapeId]);
    expect(doc().selectedObjects).toEqual([]);
    expect(layerRow('Text')).toHaveAttribute('data-hidden', 'true');
    // New text cannot land on the hidden layer: a second text layer is created.
    add(text('another'));
    expect(stack()).toEqual(['Text 2', 'Text', 'Shapes']);
    run('edit.undo');
    await user.click(within(layerRow('Text')).getByRole('button', { name: 'Layer visible' }));
    expect(painted()).toEqual([shapeId, textId]);

    // Locked: painted, but the pointer goes through and the object cannot be selected.
    await user.click(within(layerRow('Shapes')).getByRole('button', { name: 'Layer locked' }));
    const shape = viewer().querySelector(`[data-object-id="${shapeId}"]`)!;
    expect(shape).toHaveAttribute('data-locked', 'true');
    fireEvent.pointerDown(shape.querySelector('.editor-object__hit')!, { button: 0 });
    expect(doc().selectedObjects).toEqual([]);
    run('edit.selectAll');
    expect(doc().selectedObjects).toEqual([textId]);

    // Opacity multiplies into the objects of the layer.
    act(() => setActiveLayer(layers().find((layer) => layer.name === 'Text')!.id));
    fireEvent.change(screen.getByLabelText('Layer opacity, %'), { target: { value: '40' } });
    expect(viewer().querySelector(`[data-object-id="${textId}"]`)).toHaveAttribute('opacity', '0.4');
    expect(objects().find((object) => object.id === textId)!.opacity).toBe(1);
  });

  it('deletes a layer with its objects only after confirmation', async () => {
    const user = userEvent.setup();
    add(rect(10));
    add(text('note'));
    // An empty layer goes without a question.
    run('layers.new');
    run('layers.delete');
    await waitFor(() => expect(stack()).toEqual(['Text', 'Shapes']));

    run('layers.delete');
    const dialog = await screen.findByRole('dialog', { name: 'Delete layer' });
    expect(dialog).toHaveTextContent('“Text”');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(objects()).toHaveLength(2);

    run('layers.delete');
    await user.click(within(await screen.findByRole('dialog', { name: 'Delete layer' })).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(stack()).toEqual(['Shapes']));
    expect(objects()).toHaveLength(1);
    run('edit.undo');
    expect(stack()).toEqual(['Text', 'Shapes']);
    expect(objects()).toHaveLength(2);
  });

  it('moves objects between layers and lists them under their layer', async () => {
    const user = userEvent.setup();
    add(rect(10));
    add(text('note'));
    const textObject = objects()[1]!;
    const shapes = layers().find((layer) => layer.name === 'Shapes')!;

    const panel = within(screen.getByRole('complementary', { name: 'Properties panel' }));
    await user.selectOptions(panel.getByLabelText('Layer'), shapes.id);
    expect(objects().find((object) => object.id === textObject.id)!.layerId).toBe(shapes.id);
    expect(within(layerRow('Text')).getByTitle('Objects on the layer')).toHaveTextContent('0');

    // Expanding a layer lists its objects, top-most first; clicking one selects it.
    await user.click(within(layerRow('Shapes')).getByRole('button', { name: 'Show objects of the layer' }));
    const rows = layerRow('Shapes').querySelectorAll('.layer-object');
    expect([...rows].map((row) => row.textContent)).toEqual(['note', 'Shape']);
    await user.click(within(rows[1] as HTMLElement).getByRole('button', { name: 'Shape' }));
    expect(doc().selectedObjects).toEqual([objects().find((object) => object.type === 'shape')!.id]);

    // Lock a single object from the list: it can no longer be picked.
    await user.click(within(rows[1] as HTMLElement).getByRole('button', { name: 'Object locked' }));
    expect(doc().selectedObjects).toEqual([]);
    expect(enabled('arrange.unlock')).toBe(true);
    run('arrange.unlock');
    expect(objects().some((object) => object.locked)).toBe(false);
  });

  it('groups objects so they are selected together, and locks the selection', async () => {
    add(rect(10));
    add(rect(100));
    add(rect(200));
    const [first, second, third] = objects().map((object) => object.id);
    act(() => selectObjects(doc().id, [first!, second!]));
    expect(enabled('arrange.ungroup')).toBe(false);
    run('arrange.group');
    expect(objects()[0]!.groupId).toBeDefined();
    expect(objects()[0]!.groupId).toBe(objects()[1]!.groupId);

    // Clicking one member selects the whole group; the third object is separate.
    act(() => selectObjects(doc().id, []));
    fireEvent.pointerDown(viewer().querySelector(`[data-object-id="${second}"] .editor-object__hit`)!, { button: 0 });
    expect([...doc().selectedObjects].sort()).toEqual([first, second].sort());
    fireEvent.pointerUp(viewer().querySelector('.page-overlay[data-tool]')!);

    // Copies of a group form a new group.
    run('edit.duplicate');
    const copies = objects().slice(3);
    expect(copies).toHaveLength(2);
    expect(copies[0]!.groupId).toBe(copies[1]!.groupId);
    expect(copies[0]!.groupId).not.toBe(objects()[0]!.groupId);

    run('arrange.ungroup');
    expect(copies.every((copy) => objects().find((object) => object.id === copy.id)!.groupId === undefined)).toBe(true);

    act(() => selectObjects(doc().id, [third!]));
    run('arrange.lock');
    expect(objects().find((object) => object.id === third)!.locked).toBe(true);
    expect(doc().selectedObjects).toEqual([]);
  });

  it('keeps layers per page, copies them with a duplicated page and saves them', async () => {
    add(rect(10));
    add(text('note'));
    run('layers.new');
    run('view.nextPage');
    expect(layers()).toEqual([]);
    expect(screen.getByText(/This page has no layers yet/)).toBeInTheDocument();
    run('view.prevPage');
    expect(stack()).toEqual(['Layer', 'Text', 'Shapes']);

    run('pages.duplicate');
    const copy = doc().view.currentPage;
    expect(layers(copy).map((layer) => layer.name)).toEqual(layers(0).map((layer) => layer.name));
    expect(layers(copy)[0]!.id).not.toBe(layers(0)[0]!.id);
    // Objects of the copy point at the copy's own layers.
    const copyLayerIds = new Set(layers(copy).map((layer) => layer.id));
    expect(objects(copy).every((object) => copyLayerIds.has(object.layerId))).toBe(true);

    run('file.save');
    await waitFor(() => expect(api.written).toHaveLength(1));
    const saved = JSON.parse(new TextDecoder().decode(api.written[0]!.data).replace('%PDF-fake', '')) as { layers: Layer[][] };
    expect(saved.layers.map((list) => list.map((layer) => layer.name))).toEqual([
      ['Shapes', 'Text', 'Layer'],
      ['Shapes', 'Text', 'Layer'],
      [],
    ]);
    await waitFor(() => expect(doc().modified).toBe(false));

    // A layer change alone makes the document modified.
    expect(layerContext()!.active).toBeDefined();
    run('layers.moveDown');
    expect(doc().modified).toBe(true);
    run('edit.undo');
    expect(doc().modified).toBe(false);
  });
});
