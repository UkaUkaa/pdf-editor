import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../components/Modal';
import { selectActiveDocument, useDocumentsStore } from '../stores/documentsStore';

const MAX_PASSWORD_LENGTH = 127;

interface ProtectDialogProps {
  onClose: () => void;
}

/** Sets, changes or removes the password that PDFs saved from the active document are encrypted with. */
export function ProtectDialog({ onClose }: ProtectDialogProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const document = useDocumentsStore(selectActiveDocument);
  const setProtection = useDocumentsStore((state) => state.setProtection);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [visible, setVisible] = useState(false);
  const passwordId = useId();
  const repeatId = useId();
  if (!document) return null;

  const isProtected = document.protection !== null;
  const mismatch = repeat !== '' && password !== repeat;
  const valid = password !== '' && password === repeat;

  return (
    <Modal title={t('dialogs.protect.title')} onClose={onClose}>
      <form
        className="form-section"
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid) return;
          setProtection(document.id, { password });
          onClose();
        }}
      >
        {isProtected && <p className="form-hint">{t('dialogs.protect.current')}</p>}
        <div className="form-row">
          <label htmlFor={passwordId}>{t('dialogs.protect.password')}</label>
          <input
            id={passwordId}
            className="input form-row__wide"
            type={visible ? 'text' : 'password'}
            autoComplete="new-password"
            maxLength={MAX_PASSWORD_LENGTH}
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <div className="form-row">
          <label htmlFor={repeatId}>{t('dialogs.protect.repeat')}</label>
          <input
            id={repeatId}
            className="input form-row__wide"
            type={visible ? 'text' : 'password'}
            autoComplete="new-password"
            maxLength={MAX_PASSWORD_LENGTH}
            value={repeat}
            aria-invalid={mismatch}
            onChange={(event) => setRepeat(event.target.value)}
          />
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={visible} onChange={(event) => setVisible(event.target.checked)} />
          <span>{t('dialogs.protect.show')}</span>
        </label>
        {mismatch && (
          <p className="form-hint" role="alert">
            {t('dialogs.protect.mismatch')}
          </p>
        )}
        <p className="form-hint">{t('dialogs.protect.hint')}</p>
        <div className="form-actions">
          <button type="button" className="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          {isProtected && (
            <button
              type="button"
              className="button"
              onClick={() => {
                setProtection(document.id, null);
                onClose();
              }}
            >
              {t('dialogs.protect.remove')}
            </button>
          )}
          <button type="submit" className="button button--primary" disabled={!valid}>
            {isProtected ? t('dialogs.protect.change') : t('dialogs.protect.apply')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
