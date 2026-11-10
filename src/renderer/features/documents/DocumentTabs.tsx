import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useDocumentsStore } from '../../stores/documentsStore';
import { closeDocument } from './documentActions';

/** One tab per open document. Hidden while nothing is open. */
export function DocumentTabs(): React.JSX.Element | null {
  const { t } = useTranslation();
  const documents = useDocumentsStore((state) => state.documents);
  const activeId = useDocumentsStore((state) => state.activeId);
  const setActive = useDocumentsStore((state) => state.setActive);

  if (documents.length === 0) return null;

  return (
    <div className="tabs" role="tablist" aria-label={t('tabs.label')}>
      {documents.map((document) => {
        const selected = document.id === activeId;
        return (
          <div key={document.id} className="tabs__tab" data-selected={selected || undefined}>
            <button
              type="button"
              role="tab"
              className="tabs__button"
              aria-selected={selected}
              title={document.path ?? document.name}
              onClick={() => setActive(document.id)}
              onAuxClick={(event) => {
                if (event.button === 1) void closeDocument(document.id);
              }}
            >
              {document.name}
              {document.modified && <span aria-hidden> •</span>}
            </button>
            <button
              type="button"
              className="icon-button icon-button--small tabs__close"
              aria-label={t('tabs.close', { name: document.name })}
              title={t('tabs.close', { name: document.name })}
              onClick={() => void closeDocument(document.id)}
            >
              <X size={14} aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
