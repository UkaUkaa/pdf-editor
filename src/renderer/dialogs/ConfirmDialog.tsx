import { useTranslation } from 'react-i18next';
import { Modal } from '../components/Modal';
import type { ConfirmAnswer, ConfirmRequest } from '../stores/uiStore';

interface ConfirmDialogProps {
  request: ConfirmRequest;
  onAnswer: (answer: ConfirmAnswer) => void;
}

/** Asks the user to confirm an action that would discard or remove something. */
export function ConfirmDialog({ request, onAnswer }: ConfirmDialogProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <Modal title={request.title} onClose={() => onAnswer('cancel')}>
      <p>{request.message}</p>
      <div className="form-actions">
        {request.alternativeLabel && (
          <button type="button" className="button form-actions__start" onClick={() => onAnswer('alternative')}>
            {request.alternativeLabel}
          </button>
        )}
        <button type="button" className="button" onClick={() => onAnswer('cancel')}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className={request.danger ? 'button button--danger' : 'button button--primary'}
          autoFocus
          onClick={() => onAnswer('confirm')}
        >
          {request.confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
