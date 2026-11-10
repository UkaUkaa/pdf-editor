import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { selectActiveDocument, useDocumentsStore } from '../../stores/documentsStore';
import { openDroppedFiles } from '../documents/documentActions';
import { WelcomeScreen } from '../documents/WelcomeScreen';
import { PdfViewer } from '../pdf-viewer/PdfViewer';

const hasFiles = (event: React.DragEvent): boolean => event.dataTransfer.types.includes('Files');

/** Central document area: the viewer for the active document, or the welcome screen. */
export function Workspace(): React.JSX.Element {
  const { t } = useTranslation();
  const document = useDocumentsStore(selectActiveDocument);
  const [dropTarget, setDropTarget] = useState(false);

  return (
    <main
      className="workspace"
      aria-label={t('workspace.label')}
      data-drop-target={dropTarget || undefined}
      onDragOver={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setDropTarget(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(false);
      }}
      onDrop={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setDropTarget(false);
        void openDroppedFiles(event.dataTransfer.files);
      }}
    >
      {document ? <PdfViewer key={document.id} document={document} /> : <WelcomeScreen />}
    </main>
  );
}
