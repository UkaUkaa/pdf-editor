import { readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { mergeSettings, parseStoredSettings } from '@shared/schemas/settings';
import { DEFAULT_SETTINGS, type AppSettings, type AppSettingsPatch, type Language } from '@shared/types/settings';
import { writeFileAtomic } from './atomicFile';

export interface SettingsStoreOptions {
  directory: string;
  /** Language used on the very first launch, detected from the operating system. */
  detectLanguage: () => Language;
  onWarning?: (message: string) => void;
}

type Listener = (settings: AppSettings) => void;

/** Persistent application settings stored as a JSON file in the user data directory. */
export class SettingsStore {
  readonly filePath: string;
  private settings: AppSettings = DEFAULT_SETTINGS;
  private listeners = new Set<Listener>();
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly options: SettingsStoreOptions) {
    this.filePath = join(options.directory, 'settings.json');
  }

  async load(): Promise<AppSettings> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.options.onWarning?.(`Cannot read settings: ${String(error)}`);
      }
      // First launch: start from defaults with the OS language.
      this.settings = { ...DEFAULT_SETTINGS, language: this.options.detectLanguage() };
      await this.persist();
      return this.settings;
    }

    try {
      this.settings = parseStoredSettings(JSON.parse(raw));
    } catch (error) {
      // Never silently discard user data: keep the unreadable file next to the new one.
      const backup = `${this.filePath}.corrupt-${Date.now()}`;
      await rename(this.filePath, backup).catch(() => undefined);
      this.options.onWarning?.(`Settings file was unreadable and has been moved to ${backup}: ${String(error)}`);
      this.settings = { ...DEFAULT_SETTINGS, language: this.options.detectLanguage() };
      await this.persist();
    }
    return this.settings;
  }

  get(): AppSettings {
    return this.settings;
  }

  async update(patch: AppSettingsPatch): Promise<AppSettings> {
    this.settings = mergeSettings(this.settings, patch);
    for (const listener of this.listeners) listener(this.settings);
    await this.persist();
    return this.settings;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Resolves when every pending write has reached the disk. */
  flush(): Promise<void> {
    return this.writeQueue;
  }

  private persist(): Promise<void> {
    const snapshot = JSON.stringify(this.settings, null, 2);
    // Writes are serialised so an older snapshot can never overwrite a newer one.
    this.writeQueue = this.writeQueue
      .then(() => writeFileAtomic(this.filePath, snapshot))
      .catch((error) => this.options.onWarning?.(`Cannot save settings: ${String(error)}`));
    return this.writeQueue;
  }
}
