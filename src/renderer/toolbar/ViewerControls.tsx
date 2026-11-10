import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, ZoomIn, ZoomOut } from 'lucide-react';
import { CommandButton } from '../components/CommandButton';
import { formatZoom, ZOOM_PRESETS } from '../engine/rendering/zoom';
import { goToPage, setCustomZoom, setZoomMode } from '../features/documents/documentActions';
import { selectActiveDocument, useDocumentsStore } from '../stores/documentsStore';

/** Page navigation and zoom controls for the active document. */
export function ViewerControls(): React.JSX.Element {
  const { t } = useTranslation();
  const document = useDocumentsStore(selectActiveDocument);
  const currentPage = document?.view.currentPage ?? 0;
  const pageCount = document?.pages.length ?? 0;
  const [pageInput, setPageInput] = useState('');

  useEffect(() => {
    setPageInput(document ? String(currentPage + 1) : '');
  }, [document?.id, currentPage, document]);

  const commitPage = (): void => {
    const number = Number.parseInt(pageInput, 10);
    if (document && Number.isFinite(number)) goToPage(number - 1, document.id);
    // Show the page actually reached (the input may have been out of range).
    setPageInput(document ? String((useDocumentsStore.getState().documents.find((d) => d.id === document.id)?.view.currentPage ?? 0) + 1) : '');
  };

  const zoom = document?.view.effectiveZoom ?? 1;
  const zoomMode = document?.view.zoomMode ?? 'custom';
  const zoomValue = zoomMode === 'custom' ? String(zoom) : zoomMode;
  const isPreset = ZOOM_PRESETS.some((preset) => Math.abs(preset - zoom) < 0.0005);

  return (
    <>
      <div className="toolbar__group">
        <CommandButton id="view.prevPage" icon={ChevronUp} />
        <input
          className="input toolbar__page-input"
          type="text"
          inputMode="numeric"
          aria-label={t('toolbar.pageNumber')}
          disabled={!document}
          value={pageInput}
          onChange={(event) => setPageInput(event.target.value.replace(/\D/g, ''))}
          onBlur={commitPage}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commitPage();
              // Hand the keyboard back to the document, so shortcuts act on it again.
              event.currentTarget.blur();
            }
          }}
          onFocus={(event) => event.currentTarget.select()}
        />
        <span className="toolbar__text" data-testid="page-count">
          {document ? t('toolbar.pageCount', { count: pageCount }) : ''}
        </span>
        <CommandButton id="view.nextPage" icon={ChevronDown} />
      </div>
      <div className="toolbar__group">
        <CommandButton id="view.zoomOut" icon={ZoomOut} />
        <select
          className="select toolbar__zoom"
          aria-label={t('toolbar.zoom')}
          disabled={!document}
          value={document ? zoomValue : ''}
          onChange={(event) => {
            const { value } = event.target;
            if (value === 'fitPage' || value === 'fitWidth') setZoomMode(value);
            else setCustomZoom(Number(value));
          }}
        >
          {!document && <option value="">{t('common.none')}</option>}
          {document && zoomMode === 'custom' && !isPreset && <option value={String(zoom)}>{formatZoom(zoom)}</option>}
          <option value="fitPage">
            {zoomMode === 'fitPage' ? `${t('commands.view.fitPage')} (${formatZoom(zoom)})` : t('commands.view.fitPage')}
          </option>
          <option value="fitWidth">
            {zoomMode === 'fitWidth' ? `${t('commands.view.fitWidth')} (${formatZoom(zoom)})` : t('commands.view.fitWidth')}
          </option>
          {ZOOM_PRESETS.map((preset) => (
            <option key={preset} value={zoomMode === 'custom' && Math.abs(preset - zoom) < 0.0005 ? String(zoom) : String(preset)}>
              {formatZoom(preset)}
            </option>
          ))}
        </select>
        <CommandButton id="view.zoomIn" icon={ZoomIn} />
      </div>
    </>
  );
}
