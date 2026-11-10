import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/types/settings';
import { writeFileAtomic } from '../../../src/main/services/atomicFile';
import { SettingsStore } from '../../../src/main/services/settingsStore';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'pdf-editor-settings-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const createStore = (onWarning = vi.fn()): SettingsStore =>
  new SettingsStore({ directory, detectLanguage: () => 'uk', onWarning });

describe('writeFileAtomic', () => {
  it('writes the file and leaves no temporary files behind', async () => {
    const target = join(directory, 'nested', 'file.json');
    await writeFileAtomic(target, 'first');
    await writeFileAtomic(target, 'second');
    expect(await readFile(target, 'utf8')).toBe('second');
    expect(await readdir(join(directory, 'nested'))).toEqual(['file.json']);
  });
});

describe('SettingsStore', () => {
  it('uses the detected OS language on first launch and persists it', async () => {
    const store = createStore();
    const settings = await store.load();
    expect(settings).toEqual({ ...DEFAULT_SETTINGS, language: 'uk' });
    expect(JSON.parse(await readFile(store.filePath, 'utf8'))).toEqual(settings);
  });

  it('persists updates and reloads them in a new instance', async () => {
    const store = createStore();
    await store.load();
    await store.update({ theme: 'dark', language: 'ru', layout: { leftWidth: 333, leftTab: 'layers' } });

    const reloaded = await createStore().load();
    expect(reloaded.theme).toBe('dark');
    expect(reloaded.language).toBe('ru');
    expect(reloaded.layout.leftWidth).toBe(333);
    expect(reloaded.layout.leftTab).toBe('layers');
    expect(reloaded.layout.rightWidth).toBe(DEFAULT_SETTINGS.layout.rightWidth);
  });

  it('keeps the last value when updates are issued concurrently', async () => {
    const store = createStore();
    await store.load();
    await Promise.all([
      store.update({ layout: { leftWidth: 210 } }),
      store.update({ layout: { leftWidth: 220 } }),
      store.update({ layout: { leftWidth: 230 } }),
    ]);
    expect((await createStore().load()).layout.leftWidth).toBe(230);
  });

  it('notifies subscribers until they unsubscribe', async () => {
    const store = createStore();
    await store.load();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    await store.update({ theme: 'light' });
    unsubscribe();
    await store.update({ theme: 'dark' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0].theme).toBe('light');
  });

  it('backs up a corrupt file instead of discarding it', async () => {
    await writeFile(join(directory, 'settings.json'), '{ not json');
    const onWarning = vi.fn();
    const settings = await createStore(onWarning).load();

    expect(settings.language).toBe('uk');
    expect(onWarning).toHaveBeenCalledOnce();
    const files = await readdir(directory);
    const backup = files.find((name) => name.startsWith('settings.json.corrupt-'));
    expect(backup).toBeDefined();
    expect(await readFile(join(directory, backup!), 'utf8')).toBe('{ not json');
  });

  it('repairs individual invalid fields without resetting everything', async () => {
    await writeFile(join(directory, 'settings.json'), JSON.stringify({ language: 'ru', theme: 'bogus' }));
    const settings = await createStore().load();
    expect(settings.language).toBe('ru');
    expect(settings.theme).toBe(DEFAULT_SETTINGS.theme);
  });
});
