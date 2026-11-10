import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AUTOSAVE_INTERVALS,
  DEFAULT_LAYOUT,
  LANGUAGES,
  THEME_PREFERENCES,
  type Language,
  type ThemePreference,
} from '@shared/types/settings';
import { Modal } from '../components/Modal';
import { useSettingsStore } from '../stores/settingsStore';
import { useUiStore } from '../stores/uiStore';

const THEME_LABEL_KEYS: Record<ThemePreference, string> = {
  light: 'commands.view.themeLight',
  dark: 'commands.view.themeDark',
  system: 'commands.view.themeSystem',
};

interface SettingsDialogProps {
  onClose: () => void;
}

/** Application preferences. Every control changes a persisted setting immediately. */
export function SettingsDialog({ onClose }: SettingsDialogProps): React.JSX.Element {
  const { t } = useTranslation();
  const settings = useSettingsStore((state) => state.settings);
  const update = useSettingsStore((state) => state.update);
  const languageId = useId();
  const authorId = useId();
  const systemUserName = useUiStore((state) => state.systemUserName);
  const themeName = useId();
  const autosaveId = useId();
  // A value set outside this dialog (in the settings file) is shown as it is.
  const intervals = (AUTOSAVE_INTERVALS as readonly number[]).includes(settings.autosaveInterval)
    ? AUTOSAVE_INTERVALS
    : [...AUTOSAVE_INTERVALS, settings.autosaveInterval];

  return (
    <Modal title={t('settingsDialog.title')} onClose={onClose}>
      <section className="form-section">
        <h3 className="form-section__title">{t('settingsDialog.general')}</h3>
        <div className="form-row">
          <label htmlFor={languageId}>{t('settingsDialog.language')}</label>
          <select
            id={languageId}
            className="select"
            value={settings.language}
            onChange={(event) => update({ language: event.target.value as Language })}
          >
            {LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {t(`languages.${code}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label htmlFor={authorId}>{t('settingsDialog.authorName')}</label>
          <input
            id={authorId}
            className="input form-row__wide"
            maxLength={80}
            placeholder={systemUserName}
            value={settings.authorName}
            onChange={(event) => update({ authorName: event.target.value })}
          />
        </div>
        <fieldset className="form-row form-row--fieldset">
          <legend>{t('settingsDialog.theme')}</legend>
          <div className="segmented">
            {THEME_PREFERENCES.map((theme) => (
              <label key={theme} className="segmented__option">
                <input
                  type="radio"
                  name={themeName}
                  value={theme}
                  checked={settings.theme === theme}
                  onChange={() => update({ theme })}
                />
                <span>{t(THEME_LABEL_KEYS[theme])}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </section>
      <section className="form-section">
        <h3 className="form-section__title">{t('settingsDialog.autosave')}</h3>
        <div className="form-row">
          <label htmlFor={autosaveId}>{t('settingsDialog.autosaveInterval')}</label>
          <select
            id={autosaveId}
            className="select"
            value={settings.autosaveInterval}
            onChange={(event) => update({ autosaveInterval: Number(event.target.value) })}
          >
            {intervals.map((seconds) => (
              <option key={seconds} value={seconds}>
                {(AUTOSAVE_INTERVALS as readonly number[]).includes(seconds)
                  ? t(`settingsDialog.intervals.${seconds}`)
                  : t('settingsDialog.custom', { count: seconds })}
              </option>
            ))}
          </select>
        </div>
        <p className="form-hint">{t('settingsDialog.autosaveHint')}</p>
      </section>
      <section className="form-section">
        <h3 className="form-section__title">{t('settingsDialog.updates')}</h3>
        <label className="checkbox">
          <input type="checkbox" checked={settings.autoUpdate} onChange={(event) => update({ autoUpdate: event.target.checked })} />
          <span>{t('settingsDialog.autoUpdate')}</span>
        </label>
        <p className="form-hint">{t('settingsDialog.autoUpdateHint')}</p>
      </section>
      <section className="form-section">
        <h3 className="form-section__title">{t('settingsDialog.workspace')}</h3>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={!settings.layout.leftCollapsed}
            onChange={(event) => update({ layout: { leftCollapsed: !event.target.checked } })}
          />
          <span>{t('settingsDialog.showLeftPanel')}</span>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={!settings.layout.rightCollapsed}
            onChange={(event) => update({ layout: { rightCollapsed: !event.target.checked } })}
          />
          <span>{t('settingsDialog.showRightPanel')}</span>
        </label>
        <button type="button" className="button" onClick={() => update({ layout: DEFAULT_LAYOUT })}>
          {t('settingsDialog.resetLayout')}
        </button>
      </section>
    </Modal>
  );
}
