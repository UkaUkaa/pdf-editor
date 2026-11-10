import { useTranslation } from 'react-i18next';
import { Modal } from '../components/Modal';
import type { Notice } from '../stores/uiStore';

interface NoticeDialogProps {
  notice: Notice;
  onClose: () => void;
}

/** Reports problems the user has to know about, e.g. files that could not be opened. */
export function NoticeDialog({ notice, onClose }: NoticeDialogProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <Modal title={t(notice.titleKey)} onClose={onClose}>
      <ul className="notice-list">
        {notice.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <div className="form-actions">
        <button type="button" className="button button--primary" onClick={onClose}>
          {t('common.ok')}
        </button>
      </div>
    </Modal>
  );
}
