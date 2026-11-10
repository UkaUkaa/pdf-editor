import { useTranslation } from 'react-i18next';
import { Modal } from '../components/Modal';
import { useUpdatesStore } from '../features/updates/updates';

interface UpdateDialogProps {
  onClose: () => void;
}

/** Says where the application is with its updates and offers the one action that applies. */
export function UpdateDialog({ onClose }: UpdateDialogProps): React.JSX.Element {
  const { t } = useTranslation();
  const state = useUpdatesStore((store) => store.state);
  const status = state?.status ?? 'checking';
  const values = { version: state?.version ?? '', current: state?.currentVersion ?? '', progress: state?.progress ?? 0 };

  return (
    <Modal title={t('updates.title')} onClose={onClose}>
      <p className="form-hint" role="status" data-testid="update-status">
        {t(`updates.status.${status}`, values)}
      </p>
      {status === 'downloading' && <progress className="update-progress" max={100} value={values.progress} aria-label={t('updates.title')} />}
      {status === 'available' && <p className="form-hint">{t('updates.manualNote')}</p>}
      {status === 'ready' && <p className="form-hint">{t('updates.readyNote')}</p>}
      <div className="form-actions">
        <button type="button" className="button" onClick={onClose}>
          {status === 'ready' || status === 'available' ? t('updates.later') : t('common.close')}
        </button>
        {status === 'available' && (
          <button
            type="button"
            className="button button--primary"
            onClick={() => {
              void window.api.updates.openDownloadPage();
              onClose();
            }}
          >
            {t('updates.openDownloadPage')}
          </button>
        )}
        {status === 'ready' && (
          <button type="button" className="button button--primary" onClick={() => void window.api.updates.install()}>
            {t('updates.restart')}
          </button>
        )}
      </div>
    </Modal>
  );
}
