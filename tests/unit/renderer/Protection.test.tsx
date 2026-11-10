import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { App } from '@renderer/app/App';
import { closeDocument } from '@renderer/features/documents/documentActions';
import { executeCommand } from '@renderer/services/commands';
import { getActiveDocument } from '@renderer/stores/documentsStore';
import { fakeFile, mockViewportSize, setupApp, type FakeApi } from './testUtils';

const run = (id: Parameters<typeof executeCommand>[0]): void => act(() => void executeCommand(id));
const doc = () => getActiveDocument()!;
const exported = (api: FakeApi, index = -1): Record<string, unknown> =>
  JSON.parse(new TextDecoder().decode(api.written.at(index)!.data).replace('%PDF-fake', '')) as Record<string, unknown>;

async function open(api: FakeApi, name: string, descriptor: string, password?: string): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  mockViewportSize(1000, 700);
  render(<App />);
  api.dialogResults = [fakeFile(name, descriptor)];
  run('file.open');
  if (password) {
    await user.type(await screen.findByLabelText('Password'), password);
    await user.click(screen.getByRole('button', { name: 'Open' }));
  }
  await screen.findByRole('tab', { name });
  return user;
}

describe('password protection', () => {
  it('sets, changes and removes the password of the saved PDF', async () => {
    const api = await setupApp();
    const user = await open(api, 'report.pdf', '2');
    expect(doc().protection).toBeNull();
    expect(screen.queryByTestId('status-protection')).not.toBeInTheDocument();

    run('tools.protect');
    const dialog = await screen.findByRole('dialog', { name: 'Protect with Password' });
    const submit = within(dialog).getByRole('button', { name: 'Protect' });
    expect(submit).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Password to open the document'), 'пароль 1');
    await user.type(within(dialog).getByLabelText('Repeat the password'), 'пароль 2');
    expect(within(dialog).getByRole('alert')).toHaveTextContent('The passwords do not match.');
    expect(submit).toBeDisabled();
    await user.clear(within(dialog).getByLabelText('Repeat the password'));
    await user.type(within(dialog).getByLabelText('Repeat the password'), 'пароль 1');
    await user.click(submit);

    // Protection is a change of the document that has to be saved.
    expect(doc().protection).toEqual({ password: 'пароль 1' });
    expect(doc().modified).toBe(true);
    expect(screen.getByTestId('status-protection')).toHaveTextContent('Protection: password');

    run('file.save');
    await waitFor(() => expect(doc().modified).toBe(false));
    expect(exported(api)['password']).toBe('пароль 1');

    // Every way of writing a PDF uses the password: copies and extracted pages too.
    api.savePath = '/docs/copy.pdf';
    run('file.saveCopy');
    await waitFor(() => expect(api.written).toHaveLength(2));
    expect(exported(api)['password']).toBe('пароль 1');

    run('tools.protect');
    const again = await screen.findByRole('dialog', { name: 'Protect with Password' });
    expect(again).toHaveTextContent('This document is protected with a password.');
    await user.click(within(again).getByRole('button', { name: 'Remove Protection' }));
    expect(doc().protection).toBeNull();
    expect(doc().modified).toBe(true);
    run('file.save');
    await waitFor(() => expect(doc().modified).toBe(false));
    expect(exported(api)).not.toHaveProperty('password');
  });

  it('keeps the password of a protected file when it is saved again', async () => {
    const api = await setupApp();
    await open(api, 'secret.pdf', '2:hunter2', 'hunter2');
    expect(doc().protection).toEqual({ password: 'hunter2' });
    expect(doc().modified).toBe(false);

    api.savePath = '/docs/secret copy.pdf';
    run('file.saveCopy');
    await waitFor(() => expect(api.written).toHaveLength(1));
    expect(exported(api)['password']).toBe('hunter2');
  });

  it('does not write out pages of a file whose owner forbade changes', async () => {
    const api = await setupApp();
    const user = await open(api, 'locked.pdf', '2:hunter2:restricted', 'hunter2');
    api.savePath = '/docs/unlocked.pdf';
    run('file.saveCopy');
    const notice = await screen.findByRole('dialog', { name: 'The file could not be saved' });
    expect(notice).toHaveTextContent('the owner of a protected source file has not permitted changing or copying it');
    await user.click(within(notice).getByRole('button', { name: 'OK' }));
    expect(api.written).toHaveLength(0);
  });

  it('never stores the password in a project and asks for it again on opening', async () => {
    const api = await setupApp();
    const user = await open(api, 'secret.pdf', '2:hunter2', 'hunter2');
    api.savePath = '/docs/secret.pdfproject';
    run('file.saveProject');
    await waitFor(() => expect(api.written).toHaveLength(1));
    const data = api.written[0]!.data;
    const entries = unzipSync(data);
    for (const name of ['manifest.json', 'document.json']) {
      expect(new TextDecoder().decode(entries[name])).not.toContain('hunter2');
    }
    // (The fake source "file" of the tests is its own descriptor, so only the JSON parts are checked.)

    await act(() => closeDocument(doc().id));
    api.dialogResults = [{ ok: true, file: { path: '/docs/secret.pdfproject', name: 'secret.pdfproject', size: data.length, data: data.slice() } }];
    run('file.open');
    await user.type(await screen.findByLabelText('Password'), 'hunter2');
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await screen.findByRole('tab', { name: 'secret.pdfproject' });
    expect(doc().protection).toEqual({ password: 'hunter2' });
    expect(doc().modified).toBe(false);
  });
});
