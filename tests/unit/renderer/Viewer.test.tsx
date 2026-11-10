import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '@renderer/app/App';
import { hasResource } from '@renderer/engine/rendering/pageRenderer';
import { openDroppedFiles } from '@renderer/features/documents/documentActions';
import { computeCommandState, currentCommandContext, executeCommand } from '@renderer/services/commands';
import { getActiveDocument, useDocumentsStore } from '@renderer/stores/documentsStore';
import { destroyedSources, fakeFile, mockViewportSize, renderRequests, setupApp, type FakeApi } from './testUtils';

const status = (id: string): string => screen.getByTestId(`status-${id}`).textContent ?? '';

async function openThroughToolbar(api: FakeApi, ...files: ReturnType<typeof fakeFile>[]): Promise<void> {
  api.dialogResults = files;
  await userEvent.setup().click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Open…' }));
}

describe('opening documents', () => {
  let api: FakeApi;

  beforeEach(async () => {
    mockViewportSize(1000, 700);
    api = await setupApp();
    render(<App />);
  });

  it('opens a PDF, shows its pages, tab, thumbnails and status', async () => {
    await openThroughToolbar(api, fakeFile('report.pdf', '12'));

    expect(await screen.findByRole('tab', { name: 'report.pdf' })).toHaveAttribute('aria-selected', 'true');
    const viewer = screen.getByRole('region', { name: 'Document view' });
    expect(await within(viewer).findByRole('img', { name: 'Page 1' })).toBeInTheDocument();
    expect(screen.getByRole('listbox', { name: 'Page thumbnails' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page');

    expect(status('page')).toContain('1 / 12');
    expect(status('size')).toContain('210 × 297 mm');
    expect(screen.getByTestId('document-status')).toHaveTextContent('No changes');
    expect(screen.getByTestId('page-count')).toHaveTextContent('of 12');
    expect(document.title).toBe('report.pdf — PDF Editor');
    // Fit width: 1000px viewport minus padding, A4 width of 595pt at 96 dpi.
    await waitFor(() => expect(status('zoom')).toContain('122%'));
  });

  it('virtualises: a 500-page document mounts only the pages near the viewport', async () => {
    await openThroughToolbar(api, fakeFile('big.pdf', '500'));
    const viewer = await screen.findByRole('region', { name: 'Document view' });
    await within(viewer).findByRole('img', { name: 'Page 1' });

    expect(within(viewer).getAllByRole('img').length).toBeLessThan(6);
    const thumbnails = screen.getByRole('listbox', { name: 'Page thumbnails' });
    expect(within(thumbnails).getAllByRole('option').length).toBeLessThan(12);
    expect(renderRequests.length).toBeLessThan(20);
    expect(getActiveDocument()?.pages).toHaveLength(500);
  });

  it('navigates with buttons, the page field and thumbnails', async () => {
    const user = userEvent.setup();
    await openThroughToolbar(api, fakeFile('doc.pdf', '10'));
    await screen.findByRole('tab', { name: 'doc.pdf' });
    const toolbar = within(screen.getByRole('toolbar'));
    const previous = toolbar.getByRole('button', { name: 'Previous Page' });
    const next = toolbar.getByRole('button', { name: 'Next Page' });

    expect(previous).toHaveAttribute('aria-disabled', 'true');
    await user.click(next);
    expect(status('page')).toContain('2 / 10');
    expect(previous).toHaveAttribute('aria-disabled', 'false');

    const field = toolbar.getByRole('textbox', { name: 'Page number' });
    await user.clear(field);
    await user.type(field, '7{Enter}');
    expect(status('page')).toContain('7 / 10');
    // jsdom does not emit scroll events for programmatic scrolling; a browser does.
    fireEvent.scroll(screen.getByRole('region', { name: 'Document view' }));
    expect(await screen.findByRole('img', { name: 'Page 7' })).toBeInTheDocument();

    // Out-of-range input is clamped and the field shows the page actually reached.
    await user.clear(field);
    await user.type(field, '999{Enter}');
    expect(status('page')).toContain('10 / 10');
    expect(field).toHaveValue('10');
    expect(next).toHaveAttribute('aria-disabled', 'true');

    act(() => void executeCommand('view.firstPage'));
    expect(status('page')).toContain('1 / 10');
    await user.click(await screen.findByRole('option', { name: 'Page 2' }));
    expect(status('page')).toContain('2 / 10');
  });

  it('zooms in steps, by preset and by fit mode, and re-renders at the new resolution', async () => {
    const user = userEvent.setup();
    await openThroughToolbar(api, fakeFile('doc.pdf', '3'));
    await screen.findByRole('img', { name: 'Page 1' });
    await waitFor(() => expect(status('zoom')).toContain('122%'));
    const toolbar = within(screen.getByRole('toolbar'));
    const zoom = toolbar.getByRole('combobox', { name: 'Zoom level' });

    await user.click(toolbar.getByRole('button', { name: 'Zoom In' }));
    await waitFor(() => expect(status('zoom')).toContain('125%'));
    await user.click(toolbar.getByRole('button', { name: 'Zoom Out' }));
    await waitFor(() => expect(status('zoom')).toContain('110%'));

    await user.selectOptions(zoom, '200%');
    await waitFor(() => expect(status('zoom')).toContain('200%'));
    const resolutions = new Set(renderRequests.filter((r) => r.sourcePageIndex === 0).map((r) => r.pixelsPerPoint));
    expect(resolutions.has(Math.round(2 * (96 / 72) * 100) / 100)).toBe(true);

    await user.selectOptions(zoom, 'fitPage');
    // Fit page: 700px viewport minus padding, A4 height of 842pt.
    await waitFor(() => expect(status('zoom')).toContain('60%'));
    expect(getActiveDocument()?.view.zoomMode).toBe('fitPage');
  });

  it('switches view modes and steps by spreads in two-page mode', async () => {
    await openThroughToolbar(api, fakeFile('doc.pdf', '5'));
    await screen.findByRole('img', { name: 'Page 1' });

    act(() => void executeCommand('view.twoPage'));
    expect(computeCommandState(currentCommandContext()).checked).toContain('view.twoPage');
    act(() => void executeCommand('view.nextPage'));
    expect(status('page')).toContain('3 / 5');
    act(() => void executeCommand('view.lastPage'));
    expect(status('page')).toContain('5 / 5');
    expect(computeCommandState(currentCommandContext()).enabled).not.toContain('view.nextPage');

    act(() => void executeCommand('view.singlePage'));
    const viewer = screen.getByRole('region', { name: 'Document view' });
    await waitFor(() => expect(within(viewer).getAllByRole('img')).toHaveLength(1));
    expect(within(viewer).getByRole('img', { name: 'Page 5' })).toBeInTheDocument();
    fireEvent.keyDown(viewer, { key: 'ArrowLeft' });
    expect(await within(viewer).findByRole('img', { name: 'Page 4' })).toBeInTheDocument();
  });

  it('toggles the hand tool', async () => {
    const user = userEvent.setup();
    await openThroughToolbar(api, fakeFile('doc.pdf', '2'));
    await screen.findByRole('img', { name: 'Page 1' });
    const hand = within(screen.getByRole('toolbar')).getByRole('button', { name: 'Hand' });

    await user.click(hand);
    expect(hand).toHaveAttribute('aria-pressed', 'true');
    expect(status('tool')).toContain('Hand');
    expect(screen.getByRole('region', { name: 'Document view' })).toHaveAttribute('data-panning', 'true');
  });

  it('keeps separate state per document and frees resources on close', async () => {
    const user = userEvent.setup();
    await openThroughToolbar(api, fakeFile('a.pdf', '4'), fakeFile('b.pdf', '9'));
    expect(await screen.findByRole('tab', { name: 'b.pdf' })).toHaveAttribute('aria-selected', 'true');
    act(() => void executeCommand('view.nextPage'));
    expect(status('page')).toContain('2 / 9');

    await user.click(screen.getByRole('tab', { name: 'a.pdf' }));
    expect(status('page')).toContain('1 / 4');
    await user.click(screen.getByRole('tab', { name: 'b.pdf' }));
    expect(status('page')).toContain('2 / 9');

    // Opening the same path again activates the existing tab instead of duplicating it.
    await openThroughToolbar(api, fakeFile('a.pdf', '4'));
    await waitFor(() => expect(screen.getByRole('tab', { name: 'a.pdf' })).toHaveAttribute('aria-selected', 'true'));
    expect(screen.getAllByRole('tab', { name: /\.pdf$/ })).toHaveLength(2);

    const closing = getActiveDocument()!.resourceIds[0]!;
    expect(hasResource(closing)).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Close a.pdf' }));
    await waitFor(() => expect(hasResource(closing)).toBe(false));
    expect(destroyedSources).toHaveLength(1);
    expect(screen.getByRole('tab', { name: 'b.pdf' })).toHaveAttribute('aria-selected', 'true');

    act(() => void executeCommand('file.close'));
    expect(await screen.findByRole('heading', { name: 'Open a PDF to get started' })).toBeInTheDocument();
    expect(useDocumentsStore.getState().documents).toHaveLength(0);
    expect(document.title).toBe('PDF Editor');
  });

  it('reports every file that could not be opened and still opens the good ones', async () => {
    const user = userEvent.setup();
    await openThroughToolbar(
      api,
      { ok: false, path: '/x/missing.pdf', name: 'missing.pdf', error: 'notFound' },
      fakeFile('broken.pdf', 'corrupt'),
      fakeFile('good.pdf', '2'),
    );

    const dialog = await screen.findByRole('dialog', { name: 'Some files could not be opened' });
    expect(within(dialog).getByText('missing.pdf: file not found')).toBeInTheDocument();
    expect(within(dialog).getByText('broken.pdf: the file is damaged or is not a valid PDF')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'OK' }));
    expect(screen.getByRole('tab', { name: 'good.pdf' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'broken.pdf' })).not.toBeInTheDocument();
    // Only the document that really opened is remembered as recent.
    expect(api.recentFiles.map((file) => file.name)).toEqual(['good.pdf']);
  });

  it('asks for the password of a protected PDF, retries and can be cancelled', async () => {
    const user = userEvent.setup();
    await openThroughToolbar(api, fakeFile('locked.pdf', '2:secret'));

    let dialog = await screen.findByRole('dialog', { name: 'Password required' });
    await user.type(within(dialog).getByLabelText('Password'), 'wrong{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect password');
    dialog = screen.getByRole('dialog', { name: 'Password required' });
    expect(within(dialog).getByLabelText('Password')).toHaveValue('');
    await user.type(within(dialog).getByLabelText('Password'), 'secret{Enter}');
    expect(await screen.findByRole('tab', { name: 'locked.pdf' })).toBeInTheDocument();

    // Cancelling is not an error: no document and no error dialog.
    await openThroughToolbar(api, fakeFile('other.pdf', '2:secret'));
    dialog = await screen.findByRole('dialog', { name: 'Password required' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('tab', { name: 'other.pdf' })).not.toBeInTheDocument();
  });

  it('opens dropped files through their real paths', async () => {
    await act(() => openDroppedFiles([new File(['x'], 'dropped.pdf')]));
    expect(api.documents.openPaths).toHaveBeenCalledWith(['/dropped/dropped.pdf']);
    expect(await screen.findByRole('tab', { name: 'dropped.pdf' })).toBeInTheDocument();
  });
});

describe('welcome screen', () => {
  it('lists recent documents, opens one and clears the list', async () => {
    const user = userEvent.setup();
    mockViewportSize(1000, 700);
    const api = await setupApp();
    api.recentFiles = [{ path: '/docs/old.pdf', name: 'old.pdf', openedAt: 1 }];
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /old\.pdf/ }));
    expect(api.documents.openPaths).toHaveBeenCalledWith(['/docs/old.pdf']);
    const tab = await screen.findByRole('tab', { name: 'old.pdf' });

    await user.click(within(tab.parentElement!).getByRole('button', { name: 'Close old.pdf' }));
    await user.click(await screen.findByRole('button', { name: 'Clear list' }));
    expect(api.recent.clear).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('button', { name: /old\.pdf/ })).not.toBeInTheDocument());
  });
});
