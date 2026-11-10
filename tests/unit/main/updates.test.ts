import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UpdateState } from '@shared/types/updates';
import { UPDATE_CHECK_INTERVAL, UPDATE_FIRST_CHECK_DELAY, UpdateService, type UpdaterLike } from '../../../src/main/services/updates';

type Listener = (payload?: unknown) => void;

/** Stand-in for electron-updater: the test decides what each check "finds". */
function fakeUpdater(outcome: () => Array<[event: string, payload?: unknown]> | Error) {
  const listeners = new Map<string, Listener>();
  const updater = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    on: (event: string, listener: Listener) => listeners.set(event, listener),
    checkForUpdates: vi.fn(async () => {
      listeners.get('checking-for-update')?.();
      const result = outcome();
      if (result instanceof Error) throw result;
      for (const [event, payload] of result) listeners.get(event)?.(payload);
    }),
    quitAndInstall: vi.fn(),
  };
  return { updater: updater as unknown as UpdaterLike, raw: updater, emit: (event: string, payload?: unknown) => listeners.get(event)?.(payload) };
}

function service(updater: UpdaterLike | null, options: { canSelfInstall?: boolean; enabled?: boolean } = {}) {
  const states: UpdateState[] = [];
  const warnings: string[] = [];
  const instance = new UpdateService({
    updater,
    currentVersion: '1.0.0',
    canSelfInstall: options.canSelfInstall ?? true,
    isEnabled: () => options.enabled ?? true,
    onState: (state) => states.push(state),
    onWarning: (message) => warnings.push(message),
  });
  return { instance, states, warnings, statuses: () => states.map((state) => state.status) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('UpdateService', () => {
  it('downloads a new version by itself and installs it on request', async () => {
    const fake = fakeUpdater(() => [['update-available', { version: '1.1.0' }], ['download-progress', { percent: 41.6 }], ['update-downloaded', { version: '1.1.0' }]]);
    const { instance, states, statuses } = service(fake.updater);
    expect(fake.raw.autoDownload).toBe(true);
    expect(fake.raw.autoInstallOnAppQuit).toBe(true);
    expect(instance.install()).toBe(false);

    await instance.check(false);
    expect(statuses()).toEqual(['checking', 'downloading', 'downloading', 'ready']);
    expect(states[2]).toMatchObject({ version: '1.1.0', progress: 42 });
    expect(instance.getState()).toEqual({ status: 'ready', currentVersion: '1.0.0', version: '1.1.0', progress: null });

    // A waiting update is not hidden or re-downloaded by later checks.
    await instance.check(true);
    expect(fake.raw.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(instance.getState().status).toBe('ready');
    expect(instance.install()).toBe(true);
    expect(fake.raw.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('only announces the version where it cannot install by itself (unsigned macOS build)', async () => {
    const fake = fakeUpdater(() => [['update-available', { version: '2.0.0' }]]);
    const { instance, statuses } = service(fake.updater, { canSelfInstall: false });
    expect(fake.raw.autoDownload).toBe(false);
    expect(fake.raw.autoInstallOnAppQuit).toBe(false);
    await instance.check(false);
    expect(statuses()).toEqual(['checking', 'available']);
    expect(instance.getState()).toMatchObject({ version: '2.0.0', progress: null });
    expect(instance.install()).toBe(false);
    expect(fake.raw.quitAndInstall).not.toHaveBeenCalled();
  });

  it('respects the preference for automatic checks but always runs a requested one', async () => {
    const fake = fakeUpdater(() => [['update-not-available']]);
    const { instance, statuses } = service(fake.updater, { enabled: false });
    await instance.check(false);
    expect(fake.raw.checkForUpdates).not.toHaveBeenCalled();
    await instance.check(true);
    expect(statuses()).toEqual(['checking', 'upToDate']);
  });

  it('stays quiet when an automatic check fails and reports a failed manual one', async () => {
    const fake = fakeUpdater(() => new Error('net::ERR_INTERNET_DISCONNECTED'));
    const { instance, warnings } = service(fake.updater);
    await instance.check(false);
    expect(instance.getState().status).toBe('idle');
    expect(warnings).toHaveLength(1);
    await instance.check(true);
    expect(instance.getState().status).toBe('error');
    // An error event raised by the updater itself (e.g. a broken download) is reported too.
    fake.emit('update-not-available');
    fake.emit('error', new Error('sha512 mismatch'));
    expect(instance.getState().status).toBe('error');
  });

  it('does nothing in a build that cannot update', async () => {
    const { instance, states } = service(null);
    expect(instance.getState().status).toBe('unavailable');
    expect((await instance.check(true)).status).toBe('unavailable');
    expect(instance.install()).toBe(false);
    instance.start();
    expect(states).toEqual([]);
  });

  it('checks shortly after start and then periodically', async () => {
    vi.useFakeTimers();
    const fake = fakeUpdater(() => [['update-not-available']]);
    const { instance } = service(fake.updater);
    instance.start();
    expect(fake.raw.checkForUpdates).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(UPDATE_FIRST_CHECK_DELAY);
    expect(fake.raw.checkForUpdates).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL);
    expect(fake.raw.checkForUpdates).toHaveBeenCalledTimes(2);
    instance.stop();
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL * 2);
    expect(fake.raw.checkForUpdates).toHaveBeenCalledTimes(2);
  });
});
