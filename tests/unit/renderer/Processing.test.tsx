import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PageModel } from '@shared/types/document';
import type { TextObject } from '@shared/types/objects';
import { DEFAULT_TOOL_STYLE } from '@shared/types/objects';
import { App } from '@renderer/app/App';
import { toRecognisedLines, type OcrLine } from '@renderer/engine/ocr/convert';
import { createTextObject } from '@renderer/engine/objects/factory';
import { setImageEncoder } from '@renderer/features/export/imageExport';
import { cancelOcr, runOcr, setOcrEngineFactory, useOcrStore } from '@renderer/features/ocr/ocrActions';
import { addObject } from '@renderer/features/pdf-editor/objectActions';
import { replaceRanges } from '@renderer/features/search/searchActions';
import { executeCommand } from '@renderer/services/commands';
import { getActiveDocument, useDocumentsStore } from '@renderer/stores/documentsStore';
import { useSettingsStore } from '@renderer/stores/settingsStore';
import { fakeFile, mockViewportSize, setupApp, type FakeApi } from './testUtils';

const run = (id: Parameters<typeof executeCommand>[0]): void => act(() => void executeCommand(id));
const doc = () => getActiveDocument()!;
const count = (): string => screen.getByTestId('search-status').textContent ?? '';

async function open(api: FakeApi, descriptor: string): Promise<void> {
  mockViewportSize(1000, 700);
  render(<App />);
  api.dialogResults = [fakeFile('scan.pdf', descriptor)];
  run('file.open');
  await screen.findByRole('tab', { name: 'scan.pdf' });
}

/** A fake engine: every page image "contains" two lines; recognition can be made to wait. */
function installFakeOcr(options: { gate?: Promise<void>; fail?: boolean } = {}) {
  const calls: string[][] = [];
  let terminated = 0;
  setOcrEngineFactory(
    async (languages) => {
      calls.push([...languages]);
      if (options.fail) throw new Error('engine failed to start');
      return {
        recognise: async (_image, onProgress) => {
          onProgress(0.5);
          await options.gate;
          return [
            { text: 'Счёт на оплату № 42 ', bbox: { x0: 100, y0: 200, x1: 500, y1: 240 }, baseline: { x0: 100, y0: 232, x1: 500, y1: 232 } },
            { text: 'Total: 1500', bbox: { x0: 100, y0: 300, x1: 320, y1: 330 } },
            { text: '   ', bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } },
          ] satisfies OcrLine[];
        },
        terminate: async () => {
          terminated += 1;
        },
      };
    },
    // The fake page image is 1190 px wide for a 595 pt page: 2 px per point.
    async () => ({ image: new Blob(['image']), width: 1190 }),
  );
  return { calls, terminated: () => terminated };
}

afterEach(() => {
  setOcrEngineFactory(null);
  setImageEncoder(null);
  useOcrStore.setState({ running: false, done: 0, total: 0, pageProgress: 0, cancelled: false });
});

describe('OCR result conversion', () => {
  const page = (rotation: PageModel['rotation']): PageModel => ({ id: 'p', source: { kind: 'blank' }, box: { x: 0, y: 0, width: 600, height: 800 }, rotation });

  it('converts image pixels to page points and drops empty lines', () => {
    const lines = toRecognisedLines(
      [
        { text: ' Hello   world ', bbox: { x0: 120, y0: 200, x1: 520, y1: 240 }, baseline: { x0: 120, y0: 232, x1: 520, y1: 232 } },
        { text: '', bbox: { x0: 0, y0: 0, x1: 5, y1: 5 } },
      ],
      page(0),
      1200,
    );
    expect(lines).toEqual([{ text: 'Hello world', x: 60, baseline: 116, angle: 0, width: 200, fontSize: 16, fontFamily: 'sans' }]);
    // Without a reported baseline it is estimated a fifth above the bottom of the box.
    expect(toRecognisedLines([{ text: 'x', bbox: { x0: 0, y0: 100, x1: 100, y1: 200 } }], page(0), 1200)[0]!.baseline).toBe(90);
    expect(toRecognisedLines([{ text: 'x', bbox: { x0: 0, y0: 0, x1: 1, y1: 1 } }], page(0), 0)).toEqual([]);
  });

  it('maps text of a rotated page back into unrotated page space', () => {
    // Displayed turned by 90°, the page is 800 x 600 points; the image is 1600 px wide.
    const [line] = toRecognisedLines([{ text: 'Turned', bbox: { x0: 200, y0: 100, x1: 600, y1: 140 }, baseline: { x0: 200, y0: 130, x1: 600, y1: 130 } }], page(90), 1600);
    expect(line).toMatchObject({ angle: 270, width: 200, x: 65, baseline: 700 });
  });
});

describe('text recognition', () => {
  let api: FakeApi;
  beforeEach(async () => {
    api = await setupApp();
  });

  it('recognises all pages through the dialog and makes them searchable', async () => {
    const user = userEvent.setup();
    const ocr = installFakeOcr();
    await open(api, '2');
    run('tools.ocr');
    const dialog = await screen.findByRole('dialog', { name: 'Recognize text (OCR)' });
    // Fake pages have text, so "skip pages with text" has to be switched off to recognise them.
    await user.click(within(dialog).getByRole('checkbox', { name: 'Skip pages that already contain text' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'Russian' }));
    expect(useSettingsStore.getState().settings.ocrLanguages).toEqual(['eng', 'rus']);
    // The last language cannot be switched off.
    await user.click(within(dialog).getByRole('checkbox', { name: 'English' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'Russian' }));
    expect(useSettingsStore.getState().settings.ocrLanguages).toEqual(['rus']);
    await user.click(within(dialog).getByRole('checkbox', { name: 'English' }));

    await user.click(within(dialog).getByRole('button', { name: 'Recognize' }));
    const done = await screen.findByRole('dialog', { name: 'Text recognition finished' });
    expect(done).toHaveTextContent('Pages with recognised text: 2 of 2');
    expect(ocr.calls).toEqual([['eng', 'rus']]);
    expect(ocr.terminated()).toBe(1);

    const lines = doc().recognised[doc().pages[0]!.id]!;
    expect(lines.map((line) => line.text)).toEqual(['Счёт на оплату № 42', 'Total: 1500']);
    expect(lines[0]).toMatchObject({ x: 50, baseline: 116, width: 200, angle: 0 });
    expect(doc().modified).toBe(true);
    await user.click(within(done).getByRole('button', { name: 'OK' }));

    // Search covers the recognised text; undo removes it as one step.
    run('edit.find');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search in document' }), { target: { value: 'оплату' } });
    await waitFor(() => expect(count()).toBe('1 of 2'));
    // With the cursor in the search field, undo would belong to the field.
    act(() => (document.activeElement as HTMLElement).blur());
    run('edit.undo');
    await waitFor(() => expect(count()).toBe('Nothing found'));
    expect(doc().recognised).toEqual({});

    run('edit.redo');
    run('file.save');
    await waitFor(() => expect(api.written).toHaveLength(1));
    const saved = JSON.parse(new TextDecoder().decode(api.written[0]!.data).replace('%PDF-fake', '')) as { recognised: string[][] };
    expect(saved.recognised).toEqual([['Счёт на оплату № 42', 'Total: 1500'], ['Счёт на оплату № 42', 'Total: 1500']]);
  });

  it('skips pages that already have text and limits the run to the selection', async () => {
    installFakeOcr();
    await open(api, '3');
    // Fake PDF pages all have text: nothing is recognised with the default option.
    await act(async () => void (await runOcr({ languages: ['eng'], scope: 'all', skipPagesWithText: true })));
    expect(doc().recognised).toEqual({});
    expect(await screen.findByRole('dialog', { name: 'Text recognition finished' })).toHaveTextContent('0 of 3');

    run('view.lastPage');
    await act(async () => void (await runOcr({ languages: ['eng'], scope: 'selection', skipPagesWithText: false })));
    expect(Object.keys(doc().recognised)).toEqual([doc().pages[2]!.id]);
  });

  it('offers recognition of this page or the whole document straight from the toolbar', async () => {
    const user = userEvent.setup();
    const ocr = installFakeOcr();
    await open(api, '3');
    act(() => useSettingsStore.getState().update({ ocrLanguages: ['eng', 'ukr'] }));
    const toolbar = within(screen.getByRole('toolbar', { name: 'Main toolbar' }));
    const button = toolbar.getByRole('button', { name: 'Recognize text (OCR)' });

    await user.click(button);
    const menu = await screen.findByRole('menu', { name: 'Recognize text (OCR)' });
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Recognize Text on This Page',
      'Recognize Text in the Whole Document',
      'Text Recognition Options…',
    ]);

    // This page: exactly the page that is open, even with other pages selected and text already on it.
    run('view.nextPage');
    act(() => useDocumentsStore.getState().setSelection(doc().id, [doc().pages[0]!.id, doc().pages[1]!.id, doc().pages[2]!.id]));
    await user.click(within(menu).getByRole('menuitem', { name: 'Recognize Text on This Page' }));
    const done = await screen.findByRole('dialog', { name: 'Text recognition finished' });
    expect(done).toHaveTextContent('Pages with recognised text: 1 of 1');
    expect(Object.keys(doc().recognised)).toEqual([doc().pages[1]!.id]);
    expect(ocr.calls).toEqual([['eng', 'ukr']]);
    // The progress dialog has gone by itself.
    expect(screen.queryByRole('dialog', { name: 'Recognize text (OCR)' })).not.toBeInTheDocument();
    await user.click(within(done).getByRole('button', { name: 'OK' }));

    // Whole document: every page is considered, pages that already have text are left alone.
    await user.click(button);
    await user.click(within(await screen.findByRole('menu', { name: 'Recognize text (OCR)' })).getByRole('menuitem', { name: 'Recognize Text in the Whole Document' }));
    const all = await screen.findByRole('dialog', { name: 'Text recognition finished' });
    expect(all).toHaveTextContent('Pages with recognised text: 0 of 3');
    await user.click(within(all).getByRole('button', { name: 'OK' }));

    // The third item opens the dialog with all options.
    await user.click(button);
    await user.click(within(await screen.findByRole('menu', { name: 'Recognize text (OCR)' })).getByRole('menuitem', { name: 'Text Recognition Options…' }));
    expect(await screen.findByRole('dialog', { name: 'Recognize text (OCR)' })).toHaveTextContent('Skip pages that already contain text');
  });

  it('shows progress and can be cancelled without losing finished pages', async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const ocr = installFakeOcr({ gate });
    await open(api, '3');
    run('tools.ocr');
    const dialog = await screen.findByRole('dialog', { name: 'Recognize text (OCR)' });
    await user.click(within(dialog).getByRole('checkbox', { name: 'Skip pages that already contain text' }));
    await user.click(within(dialog).getByRole('button', { name: 'Recognize' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Recognizing page 1 of 3');
    await waitFor(() => expect(screen.getByRole('progressbar')).toHaveValue(17));
    // Escape and the Cancel button both mean "cancel", not "close and keep running".
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useOcrStore.getState().cancelled).toBe(true);
    expect(ocr.terminated()).toBe(1);
    release();
    await waitFor(() => expect(useOcrStore.getState().running).toBe(false));
    // The page that was in flight when the run was cancelled is discarded with the rest.
    expect(Object.keys(doc().recognised).length).toBeLessThanOrEqual(1);
    cancelOcr();
  });

  it('reports a failing engine instead of pretending to have recognised something', async () => {
    installFakeOcr({ fail: true });
    await open(api, '1');
    await act(async () => void (await runOcr({ languages: ['eng'], scope: 'all', skipPagesWithText: false })));
    expect(await screen.findByRole('dialog', { name: 'Text recognition failed' })).toBeInTheDocument();
    expect(doc().recognised).toEqual({});
    expect(doc().modified).toBe(false);
  });
});

describe('find and replace', () => {
  it('replaces character ranges from the end so offsets stay valid', () => {
    expect(replaceRanges('one two one', [[0, 3], [8, 11]], 'three')).toBe('three two three');
    expect(replaceRanges('abc', [[1, 2]], '')).toBe('ac');
    expect(replaceRanges('abc', [], 'x')).toBe('abc');
  });

  it('edits object text directly and covers original lines with replacements', async () => {
    const user = userEvent.setup();
    const api = await setupApp();
    await open(api, '2');
    act(() => addObject(doc().id, doc().pages[0]!.id, createTextObject({ x: 5, y: 5 }, DEFAULT_TOOL_STYLE, 'my line, another line')));
    run('edit.findReplace');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search in document' }), { target: { value: 'line' } });
    // Two lines per page on two pages, plus two matches in the object.
    await waitFor(() => expect(count()).toBe('1 of 6'));
    fireEvent.change(screen.getByLabelText('Replace with'), { target: { value: 'row' } });

    // Step to the first match inside the object and replace only that one.
    const objectHit = (await import('@renderer/stores/searchStore')).useSearchStore.getState().hits.findIndex((hit) => hit.source === 'object');
    await user.click(within(screen.getByRole('list', { name: 'Search' })).getAllByRole('button')[objectHit]!);
    await user.click(screen.getByRole('button', { name: 'Replace' }));
    const texts = (): TextObject[] => Object.values(doc().objects).flat().filter((object): object is TextObject => object.type === 'text');
    await waitFor(() => expect(texts().map((object) => object.text)).toEqual(['my row, another line']));
    await waitFor(() => expect(count()).toBe('1 of 5'));

    const before = doc().history.past.length;
    await user.click(screen.getByRole('button', { name: 'Replace All' }));
    const confirm = await screen.findByRole('dialog', { name: 'Find and replace' });
    expect(confirm).toHaveTextContent('(5)');
    await user.click(within(confirm).getByRole('button', { name: 'Replace All' }));
    await waitFor(() => expect(count()).toBe('Nothing found'));
    expect(doc().history.past.length).toBe(before + 1);

    const all = texts();
    expect(all.find((object) => !object.replacesOriginal)!.text).toBe('my row, another row');
    const replacements = all.filter((object) => object.replacesOriginal);
    expect(replacements.map((object) => object.text).sort()).toEqual(['Original row', 'Original row', 'Second row', 'Second row']);
    // The replacement keeps the size and baseline of the line it covers.
    expect(replacements[0]).toMatchObject({ fontSize: 12, background: '#ffffff' });

    run('edit.undo');
    await waitFor(() => expect(count()).toBe('1 of 5'));
  });
});

describe('exporting pages as images', () => {
  it('writes one image per page into the chosen folder with the chosen format', async () => {
    const user = userEvent.setup();
    const api = await setupApp();
    const encoded: Array<[string, number]> = [];
    setImageEncoder(async (_bitmap, format, quality) => {
      encoded.push([format, quality]);
      return format === 'png' ? new Uint8Array([0x89, 0x50, 0x4e, 0x47]) : new Uint8Array([0xff, 0xd8, 0xff]);
    });
    await open(api, '12');
    api.directory = '/out/images';

    run('file.exportImages');
    const dialog = await screen.findByRole('dialog', { name: 'Export pages as images' });
    await user.click(within(dialog).getByRole('radio', { name: 'JPEG' }));
    await user.selectOptions(within(dialog).getByLabelText('Resolution'), '300');
    fireEvent.change(within(dialog).getByLabelText('JPEG quality, %'), { target: { value: '60' } });
    await user.click(within(dialog).getByRole('radio', { name: 'Selected pages' }));
    await user.click(within(dialog).getByRole('button', { name: 'Choose Folder and Export' }));

    const done = await screen.findByRole('dialog', { name: 'Pages exported' });
    expect(done).toHaveTextContent('Files created: 1');
    // The page number in the name is the page's position in the document, zero-padded.
    expect(api.written.map((file) => file.path)).toEqual(['/out/images/scan-01.jpg']);
    expect(encoded).toEqual([['jpeg', 0.6]]);

    // Cancelling the folder dialog writes nothing.
    api.directory = null;
    await user.click(within(done).getByRole('button', { name: 'OK' }));
    run('file.exportImages');
    await user.click(within(await screen.findByRole('dialog', { name: 'Export pages as images' })).getByRole('button', { name: 'Choose Folder and Export' }));
    await act(async () => undefined);
    expect(api.written).toHaveLength(1);
  });
});
