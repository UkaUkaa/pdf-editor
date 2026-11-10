import { useTranslation } from 'react-i18next';
import { displaySizeInMillimetres, pageGeometry } from '../engine/coordinates/pageCoordinates';
import { formatZoom } from '../engine/rendering/zoom';
import { selectActiveDocument, useDocumentsStore } from '../stores/documentsStore';
import { useToolStore } from '../stores/toolStore';
import { useUiStore } from '../stores/uiStore';

/** Facts about the active document: page, zoom, page size, tool and modification state. */
export function StatusBar(): React.JSX.Element {
  const { t } = useTranslation();
  const document = useDocumentsStore(selectActiveDocument);
  const busy = useUiStore((state) => state.busy > 0);
  const tool = useToolStore((state) => state.tool);
  const none = t('common.none');

  const page = document?.pages[document.view.currentPage];
  const size = page ? displaySizeInMillimetres(pageGeometry(page)) : null;
  const fields: Array<[id: string, label: string, value: string]> = [
    [
      'page',
      t('status.page'),
      document ? t('status.pageValue', { page: document.view.currentPage + 1, count: document.pages.length }) : none,
    ],
    ['zoom', t('status.zoom'), document ? formatZoom(document.view.effectiveZoom) : none],
    ['size', t('status.size'), size ? t('status.sizeValue', { ...size }) : none],
    ['tool', t('status.tool'), document ? t(`tools.${tool}`) : none],
  ];
  if (document?.protection) fields.push(['protection', t('status.protection'), t('status.protected')]);

  let state = t('status.noDocument');
  if (busy) state = t('status.busy');
  else if (document) state = document.modified ? t('status.modified') : t('status.unmodified');

  return (
    <footer className="statusbar" aria-label={t('status.label')}>
      {fields.map(([id, label, value]) => (
        <span key={id} className="statusbar__field" data-testid={`status-${id}`}>
          <span className="statusbar__label">{label}:</span> {value}
        </span>
      ))}
      <span className="statusbar__spacer" />
      <span className="statusbar__field" data-testid="document-status" aria-live="polite">
        {state}
      </span>
    </footer>
  );
}
