import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../components/Modal';
import { splitDocument } from '../features/documents/documentActions';
import { selectActiveDocument, useDocumentsStore } from '../stores/documentsStore';

interface SplitDialogProps {
  onClose: () => void;
}

/** Splits the active document into several files with a fixed number of pages each. */
export function SplitDialog({ onClose }: SplitDialogProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const pageCount = useDocumentsStore((state) => selectActiveDocument(state)?.pages.length ?? 0);
  const [value, setValue] = useState('1');
  const inputId = useId();

  const pagesPerFile = Number.parseInt(value, 10);
  const valid = Number.isInteger(pagesPerFile) && pagesPerFile >= 1 && pagesPerFile < pageCount;
  const fileCount = valid ? Math.ceil(pageCount / pagesPerFile) : 0;

  return (
    <Modal title={t('dialogs.split.title')} onClose={onClose}>
      <form
        className="form-section"
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid) return;
          onClose();
          void splitDocument(pagesPerFile);
        }}
      >
        <div className="form-row">
          <label htmlFor={inputId}>{t('dialogs.split.label')}</label>
          <input
            id={inputId}
            className="input form-row__number"
            type="number"
            min={1}
            max={Math.max(1, pageCount - 1)}
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </div>
        <p className="form-hint">{t('dialogs.split.hint', { count: fileCount })}</p>
        <div className="form-actions">
          <button type="button" className="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="button button--primary" disabled={!valid}>
            {t('dialogs.split.run')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
