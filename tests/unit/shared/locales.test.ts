import { describe, expect, it } from 'vitest';
import { resolveSystemLanguage, translate, TRANSLATIONS, type TranslationTree } from '@shared/locales';
import { COMMAND_IDS } from '@shared/menu/commands';
import { collectCommandIds, filterMenuForPlatform, MENU_MODEL, type MenuNode } from '@shared/menu/menuModel';
import { LANGUAGES, LEFT_PANEL_TABS } from '@shared/types/settings';

function flatten(tree: TranslationTree, prefix = ''): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((acc, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? { ...acc, [path]: value } : { ...acc, ...flatten(value, path) };
  }, {});
}

const flat = Object.fromEntries(LANGUAGES.map((language) => [language, flatten(TRANSLATIONS[language])]));
const placeholders = (text: string): string[] => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]!).sort();

function submenuIds(items: MenuNode[]): string[] {
  return items.flatMap((item) => (item.type === 'submenu' ? [item.id, ...submenuIds(item.items)] : []));
}

describe('translations', () => {
  it.each(LANGUAGES.filter((language) => language !== 'en'))('%s has exactly the same keys as en', (language) => {
    expect(Object.keys(flat[language]!).sort()).toEqual(Object.keys(flat['en']!).sort());
  });

  it.each(LANGUAGES)('%s has no empty strings and the same placeholders as en', (language) => {
    for (const [key, value] of Object.entries(flat[language]!)) {
      expect(value.trim(), key).not.toBe('');
      expect(placeholders(value), key).toEqual(placeholders(flat['en']![key]!));
    }
  });

  it.each(LANGUAGES)('%s labels every command, menu and sidebar tab', (language) => {
    const keys = flat[language]!;
    for (const id of COMMAND_IDS) expect(keys[`commands.${id}`], id).toBeTypeOf('string');
    for (const menu of MENU_MODEL) {
      expect(keys[`menu.${menu.id}`], menu.id).toBeTypeOf('string');
      for (const id of submenuIds(menu.items)) expect(keys[`menu.${id}`], id).toBeTypeOf('string');
    }
    for (const tab of LEFT_PANEL_TABS) {
      expect(keys[`sidebar.tabs.${tab}`]).toBeTypeOf('string');
      expect(keys[`sidebar.empty.${tab}`]).toBeTypeOf('string');
    }
  });

  it('translate interpolates and falls back to English, then to the key', () => {
    expect(translate('ru', 'menu.mac.quit', { name: 'X' })).toBe('Завершить X');
    expect(translate('uk', 'menu.file')).toBe('Файл');
    expect(translate('ru', 'no.such.key')).toBe('no.such.key');
  });
});

describe('resolveSystemLanguage', () => {
  it('picks the first supported locale', () => {
    expect(resolveSystemLanguage(['uk-UA', 'en-US'])).toBe('uk');
    expect(resolveSystemLanguage(['de-DE', 'ru_RU'])).toBe('ru');
    expect(resolveSystemLanguage(['fr-FR'])).toBe('en');
    expect(resolveSystemLanguage([])).toBe('en');
  });
});

describe('menu model', () => {
  it('exposes every command exactly once', () => {
    const ids = MENU_MODEL.flatMap((menu) => collectCommandIds(menu.items));
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...COMMAND_IDS].sort());
  });

  it('filters platform-specific items and tidies separators', () => {
    const file = MENU_MODEL.find((menu) => menu.id === 'file')!;
    expect(collectCommandIds(filterMenuForPlatform(file.items, true))).not.toContain('file.quit');
    expect(collectCommandIds(filterMenuForPlatform(file.items, false))).toContain('file.quit');
    for (const menu of MENU_MODEL) {
      for (const isMac of [true, false]) {
        const items = filterMenuForPlatform(menu.items, isMac);
        expect(items[0]?.type).not.toBe('separator');
        expect(items.at(-1)?.type).not.toBe('separator');
      }
    }
  });
});
