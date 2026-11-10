import { create } from 'zustand';
import { mergeSettings } from '@shared/schemas/settings';
import type { PreloadApi } from '@shared/types/api';
import { DEFAULT_SETTINGS, type AppSettings, type AppSettingsPatch } from '@shared/types/settings';

interface SettingsState {
  settings: AppSettings;
  /** Applies the patch immediately and persists it through the main process. */
  update: (patch: AppSettingsPatch) => void;
}

let api: PreloadApi['settings'] | null = null;
let pendingWrites = 0;

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  update: (patch) => {
    set({ settings: mergeSettings(get().settings, patch) });
    if (!api) return;
    pendingWrites += 1;
    api
      .update(patch)
      .then((saved) => {
        pendingWrites -= 1;
        // The main process is authoritative once no newer local change is in flight.
        if (pendingWrites === 0) set({ settings: saved });
      })
      .catch((error: unknown) => {
        pendingWrites -= 1;
        console.error('Failed to save settings', error);
      });
  },
}));

export async function initSettingsStore(preload: PreloadApi): Promise<AppSettings> {
  api = preload.settings;
  const settings = await api.get();
  useSettingsStore.setState({ settings });
  api.onChanged((next) => {
    if (pendingWrites === 0) useSettingsStore.setState({ settings: next });
  });
  return settings;
}

/** Test helper: detaches the store from the preload API and restores defaults. */
export function resetSettingsStore(settings: AppSettings = DEFAULT_SETTINGS): void {
  api = null;
  pendingWrites = 0;
  useSettingsStore.setState({ settings });
}
