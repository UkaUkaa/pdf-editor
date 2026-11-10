import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, FolderOpen } from 'lucide-react';
import type { RecentFile } from '@shared/types/document';
import { useUiStore } from '../../stores/uiStore';
import { openPaths, openWithDialog } from './documentActions';

/** Shown in the workspace while no document is open. */
export function WelcomeScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const [recent, setRecent] = useState<RecentFile[]>([]);
  // Re-read the list after every open attempt, successful or not.
  const busy = useUiStore((state) => state.busy);

  useEffect(() => {
    let active = true;
    void window.api.recent.list().then((files) => {
      if (active) setRecent(files);
    });
    return () => {
      active = false;
    };
  }, [busy]);

  return (
    <div className="welcome">
      <FileText size={44} strokeWidth={1.25} aria-hidden />
      <h1 className="welcome__title">{t('welcome.title')}</h1>
      <p className="welcome__body">{t('welcome.body')}</p>
      <button type="button" className="button button--primary" onClick={() => void openWithDialog()}>
        <FolderOpen size={16} aria-hidden />
        {t('welcome.open')}
      </button>

      {recent.length > 0 && (
        <section className="welcome__recent" aria-labelledby="recent-heading">
          <header className="welcome__recent-header">
            <h2 id="recent-heading" className="form-section__title">
              {t('welcome.recent')}
            </h2>
            <button
              type="button"
              className="link-button"
              onClick={() => void window.api.recent.clear().then(() => setRecent([]))}
            >
              {t('welcome.clearRecent')}
            </button>
          </header>
          <ul className="welcome__recent-list">
            {recent.map((file) => (
              <li key={file.path}>
                <button type="button" className="recent-item" title={file.path} onClick={() => void openPaths([file.path])}>
                  <span className="recent-item__name">{file.name}</span>
                  <span className="recent-item__path">{file.path}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
