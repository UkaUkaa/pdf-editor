import type { Language } from '../types/settings';
import en from './en/translation.json';
import ru from './ru/translation.json';
import uk from './uk/translation.json';

export type TranslationTree = { [key: string]: string | TranslationTree };

export const TRANSLATIONS: Record<Language, TranslationTree> = { en, ru, uk };

/** Minimal dotted-key lookup with `{{name}}` interpolation, used by the main process. */
export function translate(language: Language, key: string, vars: Record<string, string | number> = {}): string {
  const lookup = (tree: TranslationTree): string | undefined => {
    let node: string | TranslationTree | undefined = tree;
    for (const part of key.split('.')) {
      if (typeof node !== 'object') return undefined;
      node = node[part];
    }
    return typeof node === 'string' ? node : undefined;
  };
  const template = lookup(TRANSLATIONS[language]) ?? lookup(TRANSLATIONS.en) ?? key;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

/** Maps an OS locale such as `uk-UA` to a supported interface language. */
export function resolveSystemLanguage(locales: readonly string[]): Language {
  for (const locale of locales) {
    const base = locale.toLowerCase().split(/[-_]/)[0];
    if (base === 'ru' || base === 'uk' || base === 'en') return base;
  }
  return 'en';
}
