import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { UpdateState } from '@shared/types/updates';
import { App } from '@renderer/app/App';
import { executeCommand } from '@renderer/services/commands';
import { setupApp } from './testUtils';

const run = (id: Parameters<typeof executeCommand>[0]): void => act(() => void executeCommand(id));
const state = (patch: Partial<UpdateState>): UpdateState => ({ status: 'idle', currentVersion: '1.0.0', version: null, progress: null, ...patch });
const dialog = () => screen.findByRole('dialog', { name: 'Updates' });

describe('updates', () => {
  it('offers to restart when an update has been downloaded, once per version', async () => {
    const api = await setupApp();
    api.updateState = state({});
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(api.updates.onState).toHaveBeenCalled());
    expect(screen.queryByRole('dialog', { name: 'Updates' })).not.toBeInTheDocument();

    // Progress is shown only if the user is looking; nothing pops up while downloading.
    act(() => api.emitUpdateState(state({ status: 'downloading', version: '1.1.0', progress: 30 })));
    expect(screen.queryByRole('dialog', { name: 'Updates' })).not.toBeInTheDocument();

    act(() => api.emitUpdateState(state({ status: 'ready', version: '1.1.0' })));
    const shown = await dialog();
    expect(within(shown).getByTestId('update-status')).toHaveTextContent('Version 1.1.0 has been downloaded and is ready to install.');
    await user.click(within(shown).getByRole('button', { name: 'Later' }));
    expect(api.updates.install).not.toHaveBeenCalled();

    // The same news is not repeated.
    act(() => api.emitUpdateState(state({ status: 'ready', version: '1.1.0' })));
    expect(screen.queryByRole('dialog', { name: 'Updates' })).not.toBeInTheDocument();

    run('help.checkUpdates');
    await user.click(within(await dialog()).getByRole('button', { name: 'Restart and Install' }));
    expect(api.updates.install).toHaveBeenCalledTimes(1);
  });

  it('points to the download page where the application cannot install updates itself', async () => {
    const api = await setupApp({ platform: 'darwin' });
    api.updateState = state({});
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(api.updates.onState).toHaveBeenCalled());
    act(() => api.emitUpdateState(state({ status: 'available', version: '2.0.0' })));
    const shown = await dialog();
    expect(shown).toHaveTextContent('Version 2.0.0 is available (you have 1.0.0).');
    expect(shown).toHaveTextContent('cannot install updates by itself');
    await user.click(within(shown).getByRole('button', { name: 'Open Download Page' }));
    expect(api.updates.openDownloadPage).toHaveBeenCalledTimes(1);
    expect(api.updates.install).not.toHaveBeenCalled();
  });

  it('reports the result of a manual check, whatever it is', async () => {
    const api = await setupApp();
    api.updateState = state({ status: 'upToDate' });
    const user = userEvent.setup();
    render(<App />);
    run('help.checkUpdates');
    expect(await dialog()).toHaveTextContent('You have the latest version (1.0.0).');
    expect(api.updates.check).toHaveBeenCalledTimes(1);
    await user.click(within(await dialog()).getAllByRole('button', { name: 'Close' }).at(-1)!);

    api.updateState = state({ status: 'error' });
    run('help.checkUpdates');
    expect(await dialog()).toHaveTextContent('Could not check for updates.');
    await user.click(within(await dialog()).getAllByRole('button', { name: 'Close' }).at(-1)!);

    api.updateState = state({ status: 'unavailable' });
    run('help.checkUpdates');
    expect(await dialog()).toHaveTextContent('Updates work only in the installed application.');
  });

  it('lets the user turn automatic checks off', async () => {
    const api = await setupApp();
    const user = userEvent.setup();
    render(<App />);
    run('settings.preferences');
    const checkbox = await screen.findByRole('checkbox', { name: 'Check for new versions automatically' });
    expect(checkbox).toBeChecked();
    await user.click(checkbox);
    expect(api.current().autoUpdate).toBe(false);
  });
});
