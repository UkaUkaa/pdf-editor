import { z } from 'zod';
import {
  DEFAULT_LAYOUT,
  DEFAULT_SETTINGS,
  LANGUAGES,
  LEFT_PANEL_TABS,
  MAX_AUTOSAVE_INTERVAL,
  OCR_LANGUAGES,
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  THEME_PREFERENCES,
  type AppSettings,
  type AppSettingsPatch,
} from '../types/settings';

const ocrLanguages = z.array(z.enum(OCR_LANGUAGES)).min(1).max(OCR_LANGUAGES.length);
const autosaveInterval = z.number().int().min(0).max(MAX_AUTOSAVE_INTERVAL);
const panelWidth = z.number().int().min(PANEL_MIN_WIDTH).max(PANEL_MAX_WIDTH);

/**
 * Tolerant schema for data read from disk: every invalid field falls back to
 * its default instead of invalidating the whole settings file.
 */
export const storedSettingsSchema = z.object({
  schemaVersion: z.literal(1).catch(1),
  language: z.enum(LANGUAGES).catch(DEFAULT_SETTINGS.language),
  theme: z.enum(THEME_PREFERENCES).catch(DEFAULT_SETTINGS.theme),
  authorName: z.string().max(80).catch(''),
  ocrLanguages: ocrLanguages.catch(DEFAULT_SETTINGS.ocrLanguages),
  autosaveInterval: autosaveInterval.catch(DEFAULT_SETTINGS.autosaveInterval),
  layout: z
    .object({
      leftWidth: panelWidth.catch(DEFAULT_LAYOUT.leftWidth),
      rightWidth: panelWidth.catch(DEFAULT_LAYOUT.rightWidth),
      leftCollapsed: z.boolean().catch(DEFAULT_LAYOUT.leftCollapsed),
      rightCollapsed: z.boolean().catch(DEFAULT_LAYOUT.rightCollapsed),
      leftTab: z.enum(LEFT_PANEL_TABS).catch(DEFAULT_LAYOUT.leftTab),
    })
    .catch(DEFAULT_LAYOUT),
});

/** Strict schema for patches arriving over IPC: unknown keys are rejected. */
export const settingsPatchSchema = z.strictObject({
  language: z.enum(LANGUAGES).optional(),
  theme: z.enum(THEME_PREFERENCES).optional(),
  authorName: z.string().max(80).optional(),
  ocrLanguages: ocrLanguages.optional(),
  autosaveInterval: autosaveInterval.optional(),
  layout: z
    .strictObject({
      leftWidth: panelWidth.optional(),
      rightWidth: panelWidth.optional(),
      leftCollapsed: z.boolean().optional(),
      rightCollapsed: z.boolean().optional(),
      leftTab: z.enum(LEFT_PANEL_TABS).optional(),
    })
    .optional(),
});

export function parseStoredSettings(raw: unknown): AppSettings {
  return storedSettingsSchema.parse(raw ?? {});
}

export function mergeSettings(current: AppSettings, patch: AppSettingsPatch): AppSettings {
  const defined = <T extends object>(value: T): Partial<T> =>
    Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
  const { layout, ...rest } = patch;
  return {
    ...current,
    ...defined(rest),
    layout: { ...current.layout, ...defined(layout ?? {}) },
  };
}
