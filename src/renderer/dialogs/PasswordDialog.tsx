import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../components/Modal';
import type { PasswordRequest } from '../stores/uiStore';

interface PasswordDialogProps {
  request: PasswordRequest;
  onAnswer: (password: string | null) => void;
}

/** Asks for the password of an encrypted PDF. The password is only passed to the PDF engine. */
export function PasswordDialog({ request, onAnswer }: PasswordDialogProps): React.JSX.Element {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const inputId = useId();

  return (
    <Modal title={t('password.title')} onClose={() => onAnswer(null)}>
      <form
        className="form-section"
        onSubmit={(event) => {
          event.preventDefault();
          onAnswer(password);
        }}
      >
        <p>{t('password.message', { name: request.fileName })}</p>
        {request.reason === 'incorrect' && (
          <p className="form-error" role="alert">
            {t('password.incorrect')}
          </p>
        )}
        <div className="form-row">
          <label htmlFor={inputId}>{t('password.label')}</label>
          <input
            id={inputId}
            className="input"
            type="password"
            autoComplete="off"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <div className="form-actions">
          <button type="button" className="button" onClick={() => onAnswer(null)}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="button button--primary">
            {t('password.open')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
