import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { TRANSLATIONS } from '@shared/locales';
import { LANGUAGES, type Language } from '@shared/types/settings';

export async function initI18n(language: Language): Promise<typeof i18n> {
  if (i18n.isInitialized) {
    await i18n.changeLanguage(language);
    return i18n;
  }
  await i18n.use(initReactI18next).init({
    resources: Object.fromEntries(LANGUAGES.map((code) => [code, { translation: TRANSLATIONS[code] }])),
    lng: language,
    fallbackLng: 'en',
    supportedLngs: [...LANGUAGES],
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return i18n;
}

export { i18n };
