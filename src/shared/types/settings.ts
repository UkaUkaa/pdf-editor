export const LANGUAGES = ['en', 'ru', 'uk'] as const;
export type Language = (typeof LANGUAGES)[number];

export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = 'light' | 'dark';

/** Languages the bundled OCR engine can recognise (Tesseract codes). */
export const OCR_LANGUAGES = ['eng', 'rus', 'ukr'] as const;
export type OcrLanguage = (typeof OCR_LANGUAGES)[number];

/** Choices for the autosave interval, in seconds; 0 turns autosave off. */
export const AUTOSAVE_INTERVALS = [0, 30, 60, 300, 600] as const;
export const MAX_AUTOSAVE_INTERVAL = 3600;

export const LEFT_PANEL_TABS = [
  'thumbnails',
  'bookmarks',
  'outline',
  'attachments',
  'search',
  'layers',
  'comments',
] as const;
export type LeftPanelTab = (typeof LEFT_PANEL_TABS)[number];

export const PANEL_MIN_WIDTH = 200;
export const PANEL_MAX_WIDTH = 560;

export interface WorkspaceLayout {
  leftWidth: number;
  rightWidth: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  leftTab: LeftPanelTab;
}

export interface AppSettings {
  schemaVersion: 1;
  language: Language;
  theme: ThemePreference;
  /** Name stamped on comments; empty means the operating-system user name. */
  authorName: string;
  /** Languages used for text recognition; at least one. */
  ocrLanguages: OcrLanguage[];
  /** Seconds between recovery copies of modified documents; 0 turns autosave off. */
  autosaveInterval: number;
  /** Whether the application looks for new versions by itself. */
  autoUpdate: boolean;
  layout: WorkspaceLayout;
}

export type AppSettingsPatch = Partial<Pick<AppSettings, 'language' | 'theme' | 'authorName' | 'ocrLanguages' | 'autosaveInterval' | 'autoUpdate'>> & {
  layout?: Partial<WorkspaceLayout>;
};

export const DEFAULT_LAYOUT: WorkspaceLayout = {
  leftWidth: 260,
  rightWidth: 300,
  leftCollapsed: false,
  rightCollapsed: false,
  leftTab: 'thumbnails',
};

export const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: 1,
  language: 'en',
  theme: 'system',
  authorName: '',
  ocrLanguages: ['eng'],
  autosaveInterval: 60,
  autoUpdate: true,
  layout: DEFAULT_LAYOUT,
};
