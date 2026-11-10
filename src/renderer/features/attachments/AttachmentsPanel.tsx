import { useTranslation } from 'react-i18next';
import { Download, Paperclip, Trash2 } from 'lucide-react';
import type { Attachment, DocumentModel } from '@shared/types/document';
import { getFileBytes, registerFile } from '../../engine/rendering/pageRenderer';
import { i18n } from '../../localization/i18n';
import { getActiveDocument, useDocumentsStore } from '../../stores/documentsStore';
import { useUiStore } from '../../stores/uiStore';

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Lets the user pick files and attaches them to the active document. */
export async function attachFiles(): Promise<void> {
  const document = getActiveDocument();
  if (!document) return;
  const results = await window.api.documents.openAttachmentsDialog();
  const current = getActiveDocument();
  if (!current || current.id !== document.id || results.length === 0) return;

  const added: Attachment[] = [];
  const problems: string[] = [];
  for (const result of results) {
    if (!result.ok) {
      problems.push(`${result.name}: ${i18n.t(`errors.open.${result.error}`)}`);
      continue;
    }
    const resourceId = crypto.randomUUID();
    registerFile(resourceId, result.file.data);
    added.push({ id: crypto.randomUUID(), name: result.file.name, size: result.file.size, resourceId });
  }
  const store = useDocumentsStore.getState();
  if (added.length > 0) {
    store.addResources(current.id, added.map((attachment) => attachment.resourceId));
    store.commit(current.id, { attachments: [...current.attachments, ...added] });
  }
  if (problems.length > 0) useUiStore.getState().showNotice({ titleKey: 'errors.openTitle', lines: problems });
}

export function removeAttachment(id: string): void {
  const document = getActiveDocument();
  if (!document) return;
  const attachments = document.attachments.filter((attachment) => attachment.id !== id);
  if (attachments.length !== document.attachments.length) useDocumentsStore.getState().commit(document.id, { attachments });
}

/** Saves an attachment to a place the user picks. The file is only written, never opened. */
export async function extractAttachment(attachment: Attachment): Promise<boolean> {
  const bytes = getFileBytes(attachment.resourceId);
  if (!bytes) return false;
  return (await window.api.documents.saveAttachment(attachment.name, bytes)) !== null;
}

/** Files embedded in the document. */
export function AttachmentsPanel({ document }: { document: DocumentModel }): React.JSX.Element {
  const { t } = useTranslation();
  if (document.attachments.length === 0) return <p className="panel__empty">{t('attachments.empty')}</p>;
  return (
    <ul className="attachments" aria-label={t('sidebar.tabs.attachments')}>
      {document.attachments.map((attachment) => (
        <li key={attachment.id} className="attachment">
          <Paperclip size={15} aria-hidden className="attachment__icon" />
          <span className="attachment__name" title={attachment.name}>
            {attachment.name}
          </span>
          <span className="attachment__size">{formatSize(attachment.size)}</span>
          <button
            type="button"
            className="icon-button icon-button--small"
            aria-label={t('attachments.save', { name: attachment.name })}
            title={t('attachments.save', { name: attachment.name })}
            onClick={() => void extractAttachment(attachment)}
          >
            <Download size={14} aria-hidden />
          </button>
          <button
            type="button"
            className="icon-button icon-button--small"
            aria-label={t('attachments.remove', { name: attachment.name })}
            title={t('attachments.remove', { name: attachment.name })}
            onClick={() => removeAttachment(attachment.id)}
          >
            <Trash2 size={14} aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}
