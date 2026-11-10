import { describe, expect, it } from 'vitest';
import { mergeSettings, parseStoredSettings, settingsPatchSchema } from '@shared/schemas/settings';
import { DEFAULT_LAYOUT, DEFAULT_SETTINGS, PANEL_MAX_WIDTH } from '@shared/types/settings';

describe('parseStoredSettings', () => {
  it('returns defaults for empty input', () => {
    expect(parseStoredSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseStoredSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid fields and repairs invalid ones individually', () => {
    const parsed = parseStoredSettings({
      language: 'uk',
      theme: 'neon',
      layout: { leftWidth: 99999, rightWidth: 320, leftTab: 'layers' },
    });
    expect(parsed.language).toBe('uk');
    expect(parsed.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(parsed.layout.leftWidth).toBe(DEFAULT_LAYOUT.leftWidth);
    expect(parsed.layout.rightWidth).toBe(320);
    expect(parsed.layout.leftTab).toBe('layers');
  });
});

describe('settingsPatchSchema', () => {
  it('accepts partial patches', () => {
    expect(settingsPatchSchema.parse({ layout: { leftCollapsed: true } })).toEqual({ layout: { leftCollapsed: true } });
  });

  it('rejects unknown keys and out-of-range values', () => {
    expect(() => settingsPatchSchema.parse({ evil: true })).toThrow();
    expect(() => settingsPatchSchema.parse({ layout: { extra: 1 } })).toThrow();
    expect(() => settingsPatchSchema.parse({ language: 'de' })).toThrow();
    expect(() => settingsPatchSchema.parse({ layout: { leftWidth: PANEL_MAX_WIDTH + 1 } })).toThrow();
  });
});

describe('mergeSettings', () => {
  it('merges nested layout without losing other fields', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { theme: 'dark', layout: { rightWidth: 400 } });
    expect(merged.theme).toBe('dark');
    expect(merged.language).toBe(DEFAULT_SETTINGS.language);
    expect(merged.layout).toEqual({ ...DEFAULT_LAYOUT, rightWidth: 400 });
  });

  it('ignores undefined values and does not mutate its input', () => {
    const before = structuredClone(DEFAULT_SETTINGS);
    const merged = mergeSettings(DEFAULT_SETTINGS, { theme: undefined, layout: { leftWidth: undefined } });
    expect(merged).toEqual(before);
    expect(DEFAULT_SETTINGS).toEqual(before);
  });
});
