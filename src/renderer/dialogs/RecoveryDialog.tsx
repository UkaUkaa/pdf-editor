import { useTranslation } from 'react-i18next';
import type { RecoveryEntry } from '@shared/types/document';
import { Modal } from '../components/Modal';
import { discardEntries, postponeRecovery, restoreAll, restoreEntry, useRecoveryStore } from '../features/project/recovery';

/** Offers the documents that had unsaved changes when the application last died. */
export function RecoveryDialog(): React.JSX.Element | null {
  const { t, i18n } = useTranslation();
  const entries = useRecoveryStore((state) => state.entries);
  const open = useRecoveryStore((state) => state.open);
  if (!open || entries.length === 0) return null;

  const time = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });
  const describe = (entry: RecoveryEntry): string =>
    `${entry.path ?? t('recovery.untitled')} · ${t('recovery.savedAt', { time: time.format(entry.savedAt) })}`;

  return (
    <Modal title={t('recovery.title')} onClose={postponeRecovery}>
      <p className="form-hint">{t('recovery.message')}</p>
      <ul className="recovery-list">
        {entries.map((entry) => (
          <li key={entry.id} className="recovery-list__item">
            <div className="recovery-list__text">
              <span className="recovery-list__name">{entry.name}</span>
              <span className="recovery-list__detail">{describe(entry)}</span>
            </div>
            <button
              type="button"
              className="button"
              aria-label={`${t('recovery.discard')}: ${entry.name}`}
              onClick={() => void discardEntries([entry])}
            >
              {t('recovery.discard')}
            </button>
            <button
              type="button"
              className="button button--primary"
              aria-label={`${t('recovery.restore')}: ${entry.name}`}
              onClick={() => void restoreEntry(entry)}
            >
              {t('recovery.restore')}
            </button>
          </li>
        ))}
      </ul>
      <div className="form-actions">
        <button type="button" className="button" onClick={postponeRecovery}>
          {t('recovery.later')}
        </button>
        {entries.length > 1 && (
          <>
            <button type="button" className="button" onClick={() => void discardEntries(entries)}>
              {t('recovery.discardAll')}
            </button>
            <button type="button" className="button button--primary" onClick={() => void restoreAll()}>
              {t('recovery.restoreAll')}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
