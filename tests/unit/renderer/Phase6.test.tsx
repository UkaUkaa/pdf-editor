import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Bookmark } from '@shared/types/document';
import type { TextObject } from '@shared/types/objects';
import { DEFAULT_TOOL_STYLE } from '@shared/types/objects';
import { App } from '@renderer/app/App';
import { createTextObject } from '@renderer/engine/objects/factory';
import { boundsOf } from '@renderer/engine/objects/geometry';
import { addObject } from '@renderer/features/pdf-editor/objectActions';
import { addHeaderFooter, addWatermark, fillPlaceholders } from '@renderer/features/stamps/stampActions';
import { executeCommand } from '@renderer/services/commands';
import { getActiveDocument } from '@renderer/stores/documentsStore';
import { useSearchStore } from '@renderer/stores/searchStore';
import { useUiStore } from '@renderer/stores/uiStore';
import { fakeFile, mockViewportSize, setupApp, type FakeApi } from './testUtils';

const run = (id: Parameters<typeof executeCommand>[0]): void => act(() => void executeCommand(id));
const doc = () => getActiveDocument()!;
const status = (id: string): string => screen.getByTestId(`status-${id}`).textContent ?? '';
const titles = (list: readonly Bookmark[] = doc().bookmarks): string =>
  list.map((item) => (item.children.length > 0 ? `${item.title}(${titles(item.children)})` : item.title)).join(', ');

async function open(api: FakeApi, descriptor: string): Promise<void> {
  mockViewportSize(1000, 700);
  render(<App />);
  api.dialogResults = [fakeFile('doc.pdf', descriptor)];
  run('file.open');
  await screen.findByRole('tab', { name: 'doc.pdf' });
}

describe('search', () => {
  let api: FakeApi;

  beforeEach(async () => {
    api = await setupApp();
    await open(api, '3');
    // Every fake page contains the lines "Original line" and "Second line".
    run('edit.find');
  });

  const type = async (query: string): Promise<void> => {
    const input = screen.getByRole('searchbox', { name: 'Search in document' });
    fireEvent.change(input, { target: { value: query } });
  };
  const count = (): string => screen.getByTestId('search-status').textContent ?? '';

  it('opens the search panel on the command and finds text on every page', async () => {
    expect(screen.getByRole('tab', { name: 'Search' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('searchbox', { name: 'Search in document' })).toHaveFocus();

    await type('line');
    await waitFor(() => expect(count()).toBe('1 of 6'));
    const results = within(screen.getByRole('list', { name: 'Search' })).getAllByRole('button');
    expect(results).toHaveLength(6);
    expect(results[0]).toHaveTextContent('Page 1');
    expect(results[0]!.querySelector('mark')).toHaveTextContent('line');
    expect(results[5]).toHaveTextContent('Page 3');

    // Matches are highlighted on the pages; the current one is marked.
    const viewer = screen.getByRole('region', { name: 'Document view' });
    const onFirstPage = viewer.querySelectorAll('.viewer__page[data-page-number="1"] .search-hit');
    expect(onFirstPage).toHaveLength(2);
    expect(onFirstPage[0]).toHaveAttribute('data-active', 'true');
    // "line" starts at character 9 of the 13-character line that is 120pt wide from x = 50.
    expect(Number(onFirstPage[0]!.getAttribute('x'))).toBeCloseTo(50 + (120 * 9) / 13, 6);

    await type('nothing like this');
    await waitFor(() => expect(count()).toBe('Nothing found'));
    expect(viewer.querySelectorAll('.search-hit')).toHaveLength(0);
  });

  it('steps through the results across pages and wraps around', async () => {
    const user = userEvent.setup();
    await type('Second');
    await waitFor(() => expect(count()).toBe('1 of 3'));
    await user.click(screen.getByRole('button', { name: 'Find Next' }));
    expect(count()).toBe('2 of 3');
    expect(status('page')).toContain('2 / 3');
    run('edit.findNext');
    expect(status('page')).toContain('3 / 3');
    run('edit.findNext');
    expect(count()).toBe('1 of 3');
    expect(status('page')).toContain('1 / 3');
    run('edit.findPrevious');
    expect(count()).toBe('3 of 3');

    // Enter in the field goes on, Shift+Enter goes back; clicking a result jumps to it.
    const input = screen.getByRole('searchbox', { name: 'Search in document' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(count()).toBe('1 of 3');
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(count()).toBe('3 of 3');
    await user.click(within(screen.getByRole('list', { name: 'Search' })).getAllByRole('button')[1]!);
    expect(status('page')).toContain('2 / 3');
  });

  it('applies the options and follows changes of the document', async () => {
    const user = userEvent.setup();
    await type('ORIGINAL');
    await waitFor(() => expect(count()).toBe('1 of 3'));
    await user.click(screen.getByRole('checkbox', { name: 'Match case' }));
    await waitFor(() => expect(count()).toBe('Nothing found'));
    await user.click(screen.getByRole('checkbox', { name: 'Match case' }));

    await type('lin');
    await waitFor(() => expect(count()).toBe('1 of 6'));
    await user.click(screen.getByRole('checkbox', { name: 'Whole words' }));
    await waitFor(() => expect(count()).toBe('Nothing found'));
    await user.click(screen.getByRole('checkbox', { name: 'Whole words' }));

    // Text added in the editor is searchable too; deleting a page removes its results.
    act(() => addObject(doc().id, doc().pages[0]!.id, createTextObject({ x: 5, y: 5 }, DEFAULT_TOOL_STYLE, 'An added line')));
    await waitFor(() => expect(count()).toBe('1 of 7'));
    expect(useSearchStore.getState().hits.filter((hit) => hit.source === 'object')).toHaveLength(1);
    run('edit.undo');
    await waitFor(() => expect(count()).toBe('1 of 6'));
  });
});

describe('bookmarks', () => {
  let api: FakeApi;

  beforeEach(async () => {
    api = await setupApp();
    await open(api, '4::outline');
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Bookmarks' }));
  });

  const item = (title: string): HTMLElement => screen.getByRole('treeitem', { name: new RegExp(title) });

  it('shows the outline of the file and jumps to pages', async () => {
    const user = userEvent.setup();
    expect(titles()).toBe('Chapter 1(Section 1.1), Chapter 2');
    expect(doc().modified).toBe(false);
    expect(item('Section 1.1')).toHaveAttribute('aria-level', '2');
    expect(item('Chapter 2')).toHaveTextContent('3');

    await user.click(within(item('Chapter 2')).getByRole('button', { name: 'Chapter 2' }));
    expect(status('page')).toContain('3 / 4');
    expect(item('Chapter 2')).toHaveAttribute('aria-selected', 'true');

    // Collapsing hides nested entries.
    await user.click(within(item('Chapter 1')).getByRole('button', { name: 'Expand or collapse' }));
    expect(screen.queryByRole('treeitem', { name: /Section 1.1/ })).not.toBeInTheDocument();
  });

  it('adds, renames, restructures and deletes bookmarks, all undoable', async () => {
    const user = userEvent.setup();
    run('view.lastPage');
    run('insert.bookmark');
    // The new bookmark is ready to be named.
    const input = await screen.findByRole('textbox', { name: 'Bookmark title' });
    expect(input).toHaveValue('Page 4');
    await user.clear(input);
    await user.type(input, 'Приложение{Enter}');
    expect(titles()).toBe('Chapter 1(Section 1.1), Chapter 2, Приложение');
    expect(doc().modified).toBe(true);
    expect(useUiStore.getState().selectedBookmarkId).toBe(doc().bookmarks[2]!.id);

    await user.click(screen.getByRole('button', { name: 'Move bookmark up' }));
    expect(titles()).toBe('Chapter 1(Section 1.1), Приложение, Chapter 2');
    await user.click(screen.getByRole('button', { name: 'Nest under the bookmark above' }));
    expect(titles()).toBe('Chapter 1(Section 1.1, Приложение), Chapter 2');
    await user.click(screen.getByRole('button', { name: 'Move one level out' }));
    expect(titles()).toBe('Chapter 1(Section 1.1), Приложение, Chapter 2');

    // Rename by double-click; Escape leaves the title alone.
    await user.dblClick(within(item('Chapter 2')).getByRole('button', { name: 'Chapter 2' }));
    await user.type(screen.getByRole('textbox', { name: 'Bookmark title' }), 'x{Escape}');
    expect(titles()).toContain('Chapter 2');

    await user.click(within(item('Chapter 1')).getByRole('button', { name: 'Chapter 1' }));
    await user.click(screen.getByRole('button', { name: 'Delete bookmark' }));
    expect(titles()).toBe('Приложение, Chapter 2');
    run('edit.undo');
    expect(titles()).toBe('Chapter 1(Section 1.1), Приложение, Chapter 2');
  });

  it('saves bookmarks with the document and keeps them attached to their pages', async () => {
    run('pages.reverse');
    run('file.save');
    await waitFor(() => expect(api.written).toHaveLength(1));
    const saved = JSON.parse(new TextDecoder().decode(api.written[0]!.data).replace('%PDF-fake', '')) as { bookmarks: Bookmark[] };
    expect(titles(saved.bookmarks)).toBe('Chapter 1(Section 1.1), Chapter 2');
    // Bookmarks follow their pages: "Chapter 1" pointed at page 1, which is now the last page.
    expect(item('Chapter 1')).toHaveTextContent('4');
    await waitFor(() => expect(doc().modified).toBe(false));
  });

  it('builds a bookmark per file when merging', async () => {
    api.dialogResults = [fakeFile('first.pdf', '3::outline'), fakeFile('second.pdf', '2')];
    run('pages.merge');
    await screen.findByRole('tab', { name: /Untitled\.pdf/ });
    expect(titles()).toBe('first(Chapter 1(Section 1.1), Chapter 2), second');
    expect(doc().bookmarks[1]!.pageId).toBe(doc().pages[3]!.id);
  });
});

describe('watermarks, headers and footers', () => {
  let api: FakeApi;

  beforeEach(async () => {
    api = await setupApp();
    await open(api, '3');
  });

  const texts = (pageIndex: number): TextObject[] =>
    (doc().objects[doc().pages[pageIndex]!.id] ?? []).filter((object): object is TextObject => object.type === 'text');

  it('adds a watermark to every page through the dialog, on its own layer, as one undo step', async () => {
    const user = userEvent.setup();
    run('insert.watermark');
    const dialog = await screen.findByRole('dialog', { name: 'Watermark' });
    expect(within(dialog).getByRole('button', { name: 'Add' })).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Text'), 'ЧЕРНОВИК');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));

    for (const pageIndex of [0, 1, 2]) {
      const [mark] = texts(pageIndex);
      expect(mark).toMatchObject({ text: 'ЧЕРНОВИК', opacity: 0.25, rotation: 315, fontSize: 64, bold: true });
      // Centred on the 595 x 842 page.
      expect(mark!.x + mark!.width / 2).toBeCloseTo(297.5);
      expect(mark!.y + mark!.height / 2).toBeCloseTo(421);
      const layer = doc().layers[doc().pages[pageIndex]!.id]!.find((candidate) => candidate.id === mark!.layerId);
      expect(layer).toMatchObject({ name: 'Watermark', type: 'annotation' });
    }
    run('edit.undo');
    expect([0, 1, 2].flatMap(texts)).toHaveLength(0);
    expect(doc().layers).toEqual({});
  });

  it('limits a watermark to the selected pages and compensates for page rotation', async () => {
    run('view.nextPage');
    run('pages.rotateCw');
    act(() => void addWatermark({ text: 'COPY', fontSize: 40, color: '#000000', opacity: 0.5, angle: 0, scope: 'selection' }));
    expect(texts(0)).toHaveLength(0);
    expect(texts(2)).toHaveLength(0);
    const [mark] = texts(1);
    // The page is shown turned by 90°, so the object is turned back to read horizontally.
    expect(mark!.rotation).toBe(270);
    expect(mark!.x + mark!.width / 2).toBeCloseTo(297.5);
    expect(mark!.y + mark!.height / 2).toBeCloseTo(421);
  });

  it('numbers pages in headers and footers with the chosen alignment and margin', async () => {
    expect(fillPlaceholders('{page} of {pages} ({page})', 2, 9)).toBe('2 of 9 (2)');
    act(() =>
      void addHeaderFooter({ header: 'Отчёт', footer: 'Page {page} / {pages}', align: 'right', fontSize: 10, margin: 30, scope: 'all' }),
    );
    for (const pageIndex of [0, 1, 2]) {
      const [header, footer] = texts(pageIndex);
      expect(header!.text).toBe('Отчёт');
      expect(footer!.text).toBe(`Page ${pageIndex + 1} / 3`);
      // Right-aligned: the right edge is one margin away from the page edge; top and bottom likewise.
      expect(boundsOf(footer!).x + footer!.width).toBeCloseTo(595 - 30);
      expect(boundsOf(header!).x + header!.width).toBeCloseTo(595 - 30);
      expect(header!.y).toBeCloseTo(30);
      expect(footer!.y + footer!.height).toBeCloseTo(842 - 30);
      expect(doc().layers[doc().pages[pageIndex]!.id]!.map((layer) => layer.name)).toEqual(['Header and footer']);
    }
    // Only a footer, centred.
    act(() => void addHeaderFooter({ header: '', footer: '{page}', align: 'center', fontSize: 10, margin: 20, scope: 'selection' }));
    const added = texts(0).at(-1)!;
    expect(added.text).toBe('1');
    expect(added.x + added.width / 2).toBeCloseTo(297.5);
    expect(texts(1)).toHaveLength(2);
  });

  it('adds headers and footers through the dialog and saves them with the document', async () => {
    const user = userEvent.setup();
    run('insert.headerFooter');
    const dialog = await screen.findByRole('dialog', { name: 'Header and footer' });
    expect(within(dialog).getByLabelText('Footer')).toHaveValue('{page} / {pages}');
    await user.type(within(dialog).getByLabelText('Header'), 'Confidential');
    await user.click(within(dialog).getByRole('radio', { name: 'Left' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(texts(2).map((object) => object.text)).toEqual(['Confidential', '3 / 3']);
    expect(texts(0)[0]!.x).toBeCloseTo(28);

    run('file.save');
    await waitFor(() => expect(api.written).toHaveLength(1));
    const saved = JSON.parse(new TextDecoder().decode(api.written[0]!.data).replace('%PDF-fake', '')) as { objects: TextObject[][] };
    expect(saved.objects.map((list) => list.map((object) => object.text))).toEqual([
      ['Confidential', '1 / 3'],
      ['Confidential', '2 / 3'],
      ['Confidential', '3 / 3'],
    ]);
  });
});
