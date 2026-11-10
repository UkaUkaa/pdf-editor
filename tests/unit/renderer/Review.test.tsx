import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { EditorObject, LinkObject, NoteObject, ShapeObject } from '@shared/types/objects';
import { DEFAULT_TOOL_STYLE } from '@shared/types/objects';
import { App } from '@renderer/app/App';
import { createLink, createNote } from '@renderer/features/comments/commentActions';
import { createMarkup } from '@renderer/features/pdf-editor/TextRunsLayer';
import { selectObjects } from '@renderer/features/pdf-editor/objectActions';
import { executeCommand } from '@renderer/services/commands';
import { getActiveDocument } from '@renderer/stores/documentsStore';
import { useSettingsStore } from '@renderer/stores/settingsStore';
import { useToolStore } from '@renderer/stores/toolStore';
import { fakeFile, mockViewportSize, setupApp, type FakeApi } from './testUtils';

const run = (id: Parameters<typeof executeCommand>[0]): void => act(() => void executeCommand(id));
const doc = () => getActiveDocument()!;
const objects = (index = 0): EditorObject[] => doc().objects[doc().pages[index]!.id] ?? [];
const notes = (): NoteObject[] => objects().filter((object): object is NoteObject => object.type === 'note');
const links = (): LinkObject[] => objects().filter((object): object is LinkObject => object.type === 'link');
const saved = (api: FakeApi, index = 0) =>
  JSON.parse(new TextDecoder().decode(api.written[index]!.data).replace('%PDF-fake', '')) as { objects: EditorObject[][]; attachments: string[] };

async function open(api: FakeApi, descriptor: string): Promise<void> {
  mockViewportSize(1000, 700);
  render(<App />);
  api.dialogResults = [fakeFile('doc.pdf', descriptor)];
  run('file.open');
  await screen.findByRole('tab', { name: 'doc.pdf' });
  // The default author comes from the operating system.
  await waitFor(() => expect(api.app.getInfo).toHaveBeenCalled());
  await act(async () => undefined);
}

describe('comments', () => {
  let api: FakeApi;
  beforeEach(async () => {
    api = await setupApp();
  });

  it('reads the comments of a PDF as editable notes, with replies, without marking the document modified', async () => {
    await open(api, '3::annotated');
    expect(doc().modified).toBe(false);
    expect(notes()).toHaveLength(1);
    expect(notes()[0]).toMatchObject({ text: 'Existing comment', author: 'Alice', color: '#ff0000', sourceAnnotation: '11' });
    expect(doc().layers[doc().pages[0]!.id]!.map((layer) => layer.name)).toEqual(['Annotations']);

    await userEvent.setup().click(screen.getByRole('tab', { name: 'Comments' }));
    const card = screen.getByRole('list', { name: 'Comments' }).querySelector('.comment') as HTMLElement;
    expect(within(card).getByText('Alice')).toBeInTheDocument();
    expect(within(card).getByLabelText('Comment text')).toHaveValue('Existing comment');
    expect(within(card).getByText('I agree')).toBeInTheDocument();
    expect(within(card).getByText('Bob')).toBeInTheDocument();
  });

  it('adds a comment with the comment tool, signs it and edits it in the panel', async () => {
    const user = userEvent.setup();
    await open(api, '2');
    run('tools.comment');
    expect(useToolStore.getState().tool).toBe('note');
    const overlay = screen.getByRole('region', { name: 'Document view' }).querySelector('.page-overlay[data-tool="note"]')!;
    fireEvent.pointerDown(overlay, { button: 0 });

    // The panel opens with the cursor in the new comment; the tool goes back to selection.
    const field = await screen.findByLabelText('Comment text');
    await waitFor(() => expect(field).toHaveFocus());
    expect(useToolStore.getState().tool).toBe('select');
    expect(notes()[0]).toMatchObject({ author: 'tester', text: '', width: 20 });
    expect(doc().layers[doc().pages[0]!.id]!.map((layer) => layer.type)).toEqual(['annotation']);

    await user.type(field, 'Нужно уточнить');
    expect(notes()[0]!.text).toBe('');
    fireEvent.blur(field);
    expect(notes()[0]!.text).toBe('Нужно уточнить');

    // Replies are signed with the name from the settings once one is set.
    act(() => useSettingsStore.getState().update({ authorName: 'Reviewer' }));
    await user.type(screen.getByLabelText('Reply…'), 'Согласен{Enter}');
    expect(notes()[0]!.replies).toEqual([expect.objectContaining({ text: 'Согласен', author: 'Reviewer' })]);
    expect(screen.getByLabelText('Reply…')).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Delete reply' }));
    expect(notes()[0]!.replies).toEqual([]);

    // Undo steps back through the reply changes and the text.
    run('edit.undo');
    expect(notes()[0]!.replies).toHaveLength(1);

    run('file.save');
    await waitFor(() => expect(api.written).toHaveLength(1));
    expect(saved(api).objects[0]!.map((object) => object.type)).toEqual(['note']);

    await user.click(screen.getByRole('button', { name: 'Delete comment' }));
    expect(notes()).toHaveLength(0);
    expect(screen.getByText(/No comments yet/)).toBeInTheDocument();
  });

  it('lists comments in reading order and jumps to their page', async () => {
    const user = userEvent.setup();
    await open(api, '3');
    act(() => createNote(doc().id, doc().pages[2]!.id, { x: 10, y: 400 }));
    act(() => createNote(doc().id, doc().pages[0]!.id, { x: 10, y: 300 }));
    act(() => createNote(doc().id, doc().pages[0]!.id, { x: 10, y: 100 }));
    const cards = [...screen.getByRole('list', { name: 'Comments' }).querySelectorAll('.comment')];
    expect(cards.map((card) => within(card as HTMLElement).getByText(/^Page \d/).textContent!.slice(0, 6))).toEqual(['Page 1', 'Page 1', 'Page 3']);
    await user.click(within(cards[2] as HTMLElement).getByRole('button', { name: /Page 3/ }));
    expect(screen.getByTestId('status-page')).toHaveTextContent('3 / 3');
    expect(doc().selectedObjects).toHaveLength(1);
    expect(cards[2]).toHaveAttribute('data-selected', 'true');
  });
});

describe('links', () => {
  let api: FakeApi;
  beforeEach(async () => {
    api = await setupApp();
  });

  it('accepts only web and mail addresses and asks before opening one', async () => {
    const user = userEvent.setup();
    await open(api, '3');
    run('insert.link');
    expect(useToolStore.getState().tool).toBe('link');
    act(() => createLink(doc().id, doc().pages[0]!.id, { x: 50, y: 60, width: 120, height: 20 }));
    expect(useToolStore.getState().tool).toBe('select');
    const panel = within(screen.getByRole('complementary', { name: 'Properties panel' }));
    const address = panel.getByLabelText('Address');
    expect(panel.getByRole('button', { name: 'Follow link' })).toBeDisabled();

    await user.type(address, 'javascript:alert(1)');
    expect(panel.getByRole('alert')).toHaveTextContent('Only web');
    fireEvent.blur(address);
    expect(links()[0]!.target).toEqual({ kind: 'url', url: '' });

    await user.clear(address);
    await user.type(address, 'example.com/docs{Enter}');
    expect(links()[0]!.target).toEqual({ kind: 'url', url: 'https://example.com/docs' });

    // Following shows the address first; nothing is opened until the user agrees.
    await user.click(panel.getByRole('button', { name: 'Follow link' }));
    const dialog = await screen.findByRole('dialog', { name: 'Open external link?' });
    expect(dialog).toHaveTextContent('https://example.com/docs');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(api.openedUrls).toEqual([]);
    await user.click(panel.getByRole('button', { name: 'Follow link' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Open external link?' })).getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(api.openedUrls).toEqual(['https://example.com/docs']));
  });

  it('links to pages and follows imported links', async () => {
    const user = userEvent.setup();
    await open(api, '3::annotated');
    expect(links().map((link) => link.target.kind)).toEqual(['url', 'page']);
    expect(links()[0]!.target).toEqual({ kind: 'url', url: 'https://example.com/docs' });

    // The imported page link leads to page 2.
    act(() => selectObjects(doc().id, [links()[1]!.id]));
    const panel = within(screen.getByRole('complementary', { name: 'Properties panel' }));
    expect(panel.getByLabelText('Page number')).toHaveValue(2);
    await user.click(panel.getByRole('button', { name: 'Follow link' }));
    expect(screen.getByTestId('status-page')).toHaveTextContent('2 / 3');
    expect(api.openedUrls).toEqual([]);

    // Retarget it to page 3; the link follows its page when pages move.
    run('view.firstPage');
    act(() => selectObjects(doc().id, [links()[1]!.id]));
    const pageField = (): HTMLElement =>
      within(screen.getByRole('complementary', { name: 'Properties panel' })).getByLabelText('Page number');
    fireEvent.change(pageField(), { target: { value: '3' } });
    expect(links()[1]!.target).toEqual({ kind: 'page', pageId: doc().pages[2]!.id });
    fireEvent.change(pageField(), { target: { value: '99' } });
    expect(links()[1]!.target).toEqual({ kind: 'page', pageId: doc().pages[2]!.id });
  });
});

describe('attachments', () => {
  it('lists, adds, extracts, removes and saves attachments', async () => {
    const user = userEvent.setup();
    const api = await setupApp();
    await open(api, '2::annotated');
    await user.click(screen.getByRole('tab', { name: 'Attachments' }));
    const list = (): HTMLElement => screen.getByRole('list', { name: 'Attachments' });
    expect(within(list()).getByText('data.csv')).toBeInTheDocument();
    expect(within(list()).getByText('8 B')).toBeInTheDocument();
    expect(doc().modified).toBe(false);

    api.attachmentResults = [
      { ok: true, file: { path: '/files/отчёт.xlsx', name: 'отчёт.xlsx', size: 2048, data: new Uint8Array(2048) } },
      { ok: false, path: '/files/huge.bin', name: 'huge.bin', error: 'tooLarge' },
    ];
    run('insert.attachment');
    const notice = await screen.findByRole('dialog', { name: 'Some files could not be opened' });
    expect(notice).toHaveTextContent('huge.bin: the file is too large');
    await user.click(within(notice).getByRole('button', { name: 'OK' }));
    expect(doc().attachments.map((attachment) => attachment.name)).toEqual(['data.csv', 'отчёт.xlsx']);
    expect(within(list()).getByText('2.0 KB')).toBeInTheDocument();
    expect(doc().modified).toBe(true);

    // Extracting hands the exact bytes to the save dialog of the main process.
    await user.click(screen.getByRole('button', { name: 'Save data.csv to disk…' }));
    await waitFor(() => expect(api.savedAttachments).toHaveLength(1));
    expect(new TextDecoder().decode(api.savedAttachments[0]!.data)).toBe('a,b\n1,2\n');

    await user.click(screen.getByRole('button', { name: 'Remove data.csv' }));
    expect(doc().attachments.map((attachment) => attachment.name)).toEqual(['отчёт.xlsx']);
    run('edit.undo');
    expect(doc().attachments).toHaveLength(2);

    run('file.save');
    await waitFor(() => expect(api.written).toHaveLength(1));
    expect(saved(api).attachments).toEqual(['data.csv', 'отчёт.xlsx']);
    await waitFor(() => expect(doc().modified).toBe(false));
  });
});

describe('text markup', () => {
  const runLine = { text: 'Original line', x: 50, baseline: 100, angle: 0, width: 120, fontSize: 12, fontFamily: 'serif' as const };

  it('builds underline, strikethrough and highlight marks for a whole line or part of it', () => {
    const underline = createMarkup(runLine, 'underline', 60, 60, DEFAULT_TOOL_STYLE);
    expect(underline).toMatchObject({ shape: 'line', x: 50, width: 120, height: 0, stroke: DEFAULT_TOOL_STYLE.stroke });
    expect(underline.y).toBeCloseTo(100 + 12 * 0.12);
    expect(underline.strokeWidth).toBeCloseTo(0.84);

    const strike = createMarkup(runLine, 'strikethrough', 150, 90, DEFAULT_TOOL_STYLE);
    expect(strike).toMatchObject({ shape: 'line', x: 90, width: 60 });
    expect(strike.y).toBeCloseTo(100 - 12 * 0.3);

    // A drag that runs past the line is clipped to it.
    const mark = createMarkup(runLine, 'markText', 100, 9999, DEFAULT_TOOL_STYLE);
    expect(mark).toMatchObject({ shape: 'rect', x: 100, width: 70, stroke: null, fill: DEFAULT_TOOL_STYLE.highlightColor, opacity: 0.4 });
    expect(mark.y).toBeCloseTo(100 - 12 * 0.85);
    expect(mark.height).toBeCloseTo(12 * 1.07);
  });

  it('marks lines of the page with the markup tools', async () => {
    const api = await setupApp();
    await open(api, '2');
    run('tools.underline');
    const viewer = screen.getByRole('region', { name: 'Document view' });
    await waitFor(() => expect(viewer.querySelector('.text-runs[data-mode="underline"] .text-run')).not.toBeNull());
    const line = viewer.querySelector('.viewer__page[data-page-number="1"] .text-run[data-text-run="Original line"]')!;
    fireEvent.pointerDown(line, { button: 0 });
    fireEvent.pointerUp(line);
    const shapes = (): ShapeObject[] => objects().filter((object): object is ShapeObject => object.type === 'shape');
    expect(shapes()).toHaveLength(1);
    expect(shapes()[0]).toMatchObject({ shape: 'line', x: 50, width: 120 });
    // The tool stays active for the next line, with nothing selected.
    expect(useToolStore.getState().tool).toBe('underline');
    expect(doc().selectedObjects).toEqual([]);

    run('tools.highlightText');
    await waitFor(() => expect(viewer.querySelector('.text-runs[data-mode="markText"]')).not.toBeNull());
    const second = viewer.querySelector('.viewer__page[data-page-number="1"] .text-run[data-text-run="Second line"]')!;
    fireEvent.pointerDown(second, { button: 0 });
    fireEvent.pointerUp(second);
    expect(shapes().map((shape) => shape.shape)).toEqual(['line', 'rect']);
    run('edit.undo');
    expect(shapes()).toHaveLength(1);
  });
});
