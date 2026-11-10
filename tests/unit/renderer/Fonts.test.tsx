import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { cssFontFamily, fontAscent, fontKey, FONT_ASCENT } from '@shared/fonts';
import type { SystemFontFamily } from '@shared/types/fonts';
import { DEFAULT_TOOL_STYLE, type TextObject } from '@shared/types/objects';
import { App } from '@renderer/app/App';
import { effectiveVariant, getFaceBytes } from '@renderer/engine/fonts/fontRegistry';
import { createTextObject } from '@renderer/engine/objects/factory';
import { addObject } from '@renderer/features/pdf-editor/objectActions';
import { executeCommand } from '@renderer/services/commands';
import { getActiveDocument } from '@renderer/stores/documentsStore';
import { fakeFile, mockViewportSize, setupApp, type FakeApi } from './testUtils';

const run = (id: Parameters<typeof executeCommand>[0]): void => act(() => void executeCommand(id));
const doc = () => getActiveDocument()!;
const textObject = (): TextObject => Object.values(doc().objects).flat().find((object) => object.type === 'text') as TextObject;
const decode = (bytes: Uint8Array | null): string | null => (bytes ? new TextDecoder().decode(bytes) : null);

const all = { regular: true, bold: true, italic: true, boldItalic: true };
const FONTS: SystemFontFamily[] = [
  { family: 'Arial', ...all, ascent: 0.905 },
  { family: 'Impact', regular: true, bold: false, italic: false, boldItalic: false, ascent: 1.0 },
  { family: 'Times New Roman', ...all, ascent: 0.891 },
  { family: 'Zapfino', regular: true, bold: false, italic: false, boldItalic: false, ascent: 1.1 },
];

async function openWithText(api: FakeApi, fontFamily?: string): Promise<ReturnType<typeof userEvent.setup>> {
  api.systemFonts = FONTS;
  const user = userEvent.setup();
  mockViewportSize(1000, 700);
  render(<App />);
  api.dialogResults = [fakeFile('report.pdf', '2')];
  run('file.open');
  await screen.findByRole('tab', { name: 'report.pdf' });
  const object = createTextObject({ x: 100, y: 200 }, DEFAULT_TOOL_STYLE, 'Договор № 7');
  act(() => addObject(doc().id, doc().pages[0]!.id, fontFamily ? { ...object, fontFamily } : object));
  return user;
}

describe('fonts installed on the computer', () => {
  it('lists bundled fonts, then popular installed ones, then the rest', async () => {
    const api = await setupApp();
    await openWithText(api);
    const select = within(screen.getByRole('complementary', { name: 'Properties panel' })).getByLabelText('Font');
    await waitFor(() => expect(within(select).getAllByRole('group')).toHaveLength(3));
    const groups = within(select).getAllByRole('group') as HTMLOptGroupElement[];
    expect(groups.map((group) => [group.label, [...group.children].map((option) => option.textContent)])).toEqual([
      ['Built-in', ['DejaVu Sans', 'DejaVu Serif', 'DejaVu Sans Mono']],
      // Times New Roman leads the list wherever it is installed.
      ['Popular', ['Times New Roman', 'Arial', 'Impact']],
      ['Installed on this computer', ['Zapfino']],
    ]);
  });

  it('applies an installed font: loads its files, uses its own name on screen and its metrics', async () => {
    const api = await setupApp();
    const user = await openWithText(api);
    const panel = within(screen.getByRole('complementary', { name: 'Properties panel' }));
    await waitFor(() => expect(within(panel.getByLabelText('Font')).getByRole('option', { name: 'Times New Roman' })).toBeInTheDocument());
    expect(api.fonts.read).not.toHaveBeenCalled();

    await user.selectOptions(panel.getByLabelText('Font'), 'Times New Roman');
    await waitFor(() => expect(textObject().fontFamily).toBe('Times New Roman'));
    // All four styles of the family were fetched, by name only.
    expect(api.fonts.read).toHaveBeenCalledTimes(4);
    expect(api.fonts.read).toHaveBeenCalledWith({ family: 'Times New Roman', bold: true, italic: true });

    const drawn = document.querySelector('.editor-object[data-object-type="text"] text')!;
    expect(drawn.getAttribute('font-family')).toBe('"PDF Editor · Times New Roman", "PDF Editor Sans"');
    expect(cssFontFamily('Times New Roman')).not.toMatch(/^"Times New Roman"/);
    expect(fontAscent('Times New Roman')).toBe(0.891);
    expect(fontAscent('Unknown Font')).toBe(FONT_ASCENT);

    // The exporter gets exactly the file of the style in use.
    await user.click(panel.getByRole('button', { name: 'Bold' }));
    expect(fontKey(textObject().fontFamily, textObject())).toBe('system:Times New Roman:b');
    expect(decode(await getFaceBytes('Times New Roman', textObject()))).toBe('font:Times New Roman:b');

    // It is one undoable change.
    run('edit.undo');
    run('edit.undo');
    expect(textObject().fontFamily).toBe('sans');
  });

  it('never fakes a missing style: a family without bold uses its regular face everywhere', async () => {
    const api = await setupApp();
    const user = await openWithText(api);
    const panel = within(screen.getByRole('complementary', { name: 'Properties panel' }));
    await waitFor(() => expect(within(panel.getByLabelText('Font')).getByRole('option', { name: 'Impact' })).toBeInTheDocument());
    await user.selectOptions(panel.getByLabelText('Font'), 'Impact');
    await waitFor(() => expect(textObject().fontFamily).toBe('Impact'));
    await user.click(panel.getByRole('button', { name: 'Bold' }));
    await user.click(panel.getByRole('button', { name: 'Italic' }));
    expect(textObject()).toMatchObject({ bold: true, italic: true });

    expect(effectiveVariant('Impact', textObject())).toEqual({ bold: false, italic: false });
    const drawn = document.querySelector('.editor-object[data-object-type="text"] text')!;
    expect(drawn.getAttribute('font-weight')).toBe('400');
    expect(drawn.getAttribute('font-style')).toBe('normal');
    expect(decode(await getFaceBytes('Impact', textObject()))).toBe('font:Impact:');
    expect(api.fonts.read).toHaveBeenCalledTimes(1);
  });

  it('shows a font that is not installed here honestly and keeps its name in the document', async () => {
    const api = await setupApp();
    await openWithText(api, 'Corporate Sans Pro');
    const select = within(screen.getByRole('complementary', { name: 'Properties panel' })).getByLabelText('Font') as HTMLSelectElement;
    await waitFor(() => expect(within(select).getByRole('option', { name: 'Corporate Sans Pro (not installed)' })).toBeInTheDocument());
    expect(select.value).toBe('Corporate Sans Pro');
    // Nothing is fetched for it, and the exporter falls back to the bundled font shown on screen.
    expect(api.fonts.read).not.toHaveBeenCalled();
    expect(await getFaceBytes('Corporate Sans Pro', textObject())).toBeNull();
    expect(effectiveVariant('Corporate Sans Pro', { bold: true, italic: false })).toEqual({ bold: true, italic: false });

    // Saving a project and opening it again keeps the name, so the font returns where it is installed.
    api.savePath = '/docs/fonts.pdfproject';
    run('file.saveProject');
    await waitFor(() => expect(api.written).toHaveLength(1));
    expect(textObject().fontFamily).toBe('Corporate Sans Pro');
  });

  it('loads the fonts of a document that already uses them', async () => {
    const api = await setupApp();
    await openWithText(api, 'Arial');
    await waitFor(() => expect(api.fonts.read).toHaveBeenCalledTimes(4));
    expect(api.fonts.read).toHaveBeenCalledWith({ family: 'Arial', bold: false, italic: false });
    expect(decode(await getFaceBytes('Arial', { bold: false, italic: true }))).toBe('font:Arial:i');
  });
});
