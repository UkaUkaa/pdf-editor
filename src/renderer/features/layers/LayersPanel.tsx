import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  FileText,
  Image,
  Layers,
  Lock,
  LockOpen,
  MessageSquare,
  Pencil,
  Shapes,
  Type,
  type LucideIcon,
} from 'lucide-react';
import type { DocumentModel } from '@shared/types/document';
import type { Layer, LayerType } from '@shared/types/layers';
import type { EditorObject } from '@shared/types/objects';
import { ContextMenu, type ContextMenuItem } from '../../components/ContextMenu';
import { countObjects } from '../../engine/layers/layerOperations';
import { useUiStore } from '../../stores/uiStore';
import { activateTool, selectableObjects, selectObjects, setObjectLock } from '../pdf-editor/objectActions';
import { layerContext, moveLayerTo, renameLayer, setActiveLayer, setLayerProperties } from './layerActions';

const TYPE_ICONS: Record<LayerType, LucideIcon> = {
  text: Type,
  image: Image,
  drawing: Pencil,
  shapes: Shapes,
  annotation: MessageSquare,
  custom: Layers,
};
/** Marks drags that carry a layer of this panel. */
const DRAG_TYPE = 'application/x-pdf-editor-layer';

const CONTEXT_MENU: readonly ContextMenuItem[] = [
  'layers.rename',
  'layers.duplicate',
  'separator',
  'layers.moveUp',
  'layers.moveDown',
  'layers.merge',
  'separator',
  'layers.delete',
];

function NameEditor({ layer, onDone }: { layer: Layer; onDone: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  const [name, setName] = useState(layer.name);
  const cancelled = useRef(false);
  return (
    <input
      className="input layer__name-input"
      aria-label={t('commands.layers.rename')}
      autoFocus
      value={name}
      maxLength={80}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setName(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onBlur={() => {
        if (!cancelled.current) renameLayer(layer.id, name);
        onDone();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          cancelled.current = true;
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function ObjectRow(props: { document: DocumentModel; pageId: string; object: EditorObject; selectable: boolean }): React.JSX.Element {
  const { t } = useTranslation();
  const { document, pageId, object, selectable } = props;
  const selected = document.selectedObjects.includes(object.id);
  const label =
    object.type === 'text' && object.text.trim() !== ''
      ? object.text.trim().replace(/\s+/g, ' ').slice(0, 28)
      : t(`properties.types.${object.type}`);
  const LockIcon = object.locked ? Lock : LockOpen;

  return (
    <li className="layer-object" data-selected={selected || undefined} data-object-row={object.id}>
      <button
        type="button"
        className="layer-object__name"
        aria-pressed={selected}
        aria-disabled={!selectable}
        title={label}
        onClick={() => {
          if (!selectable) return;
          activateTool('select');
          selectObjects(document.id, [object.id]);
        }}
      >
        {label}
      </button>
      <button
        type="button"
        className="icon-button icon-button--small"
        aria-label={t('layers.objectLocked')}
        title={t('layers.objectLocked')}
        aria-pressed={Boolean(object.locked)}
        onClick={() => setObjectLock(document.id, pageId, [object.id], !object.locked)}
      >
        <LockIcon size={14} aria-hidden />
      </button>
    </li>
  );
}

interface LayersPanelProps {
  document: DocumentModel;
}

/** Layer stack of the current page, top-most layer first, with the original page content underneath. */
export function LayersPanel({ document }: LayersPanelProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const renamingId = useUiStore((state) => state.renamingLayerId);
  const setRenaming = useUiStore((state) => state.setRenamingLayer);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [dropGap, setDropGap] = useState<number | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const listRef = useRef<HTMLUListElement>(null);

  const context = layerContext(document);
  // A rename in progress ends when its layer disappears (page change, undo, deletion).
  const renamingExists = context?.layers.some((layer) => layer.id === renamingId) ?? false;
  useEffect(() => {
    if (renamingId && !renamingExists) setRenaming(null);
  }, [renamingId, renamingExists, setRenaming]);

  if (!context) return null;
  const { layers, objects, active, pageId } = context;
  // The panel lists the stack the way it is seen: top-most layer first.
  const visual = [...layers].reverse();
  const selectableIds = new Set(selectableObjects(document, pageId).map((object) => object.id));

  const isLayerDrag = (event: React.DragEvent): boolean => event.dataTransfer.types.includes(DRAG_TYPE);
  const gapFromEvent = (event: React.DragEvent): number => {
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>(':scope > .layer') ?? [])];
    const index = rows.findIndex((row) => {
      const rect = row.getBoundingClientRect();
      return event.clientY < rect.top + rect.height / 2;
    });
    return index === -1 ? rows.length : index;
  };

  return (
    <div className="layers">
      <ul
        ref={listRef}
        className="layers__list"
        aria-label={t('sidebar.tabs.layers')}
        onDragOver={(event) => {
          if (!isLayerDrag(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          setDropGap(gapFromEvent(event));
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropGap(null);
        }}
        onDrop={(event) => {
          if (!isLayerDrag(event)) return;
          event.preventDefault();
          setDropGap(null);
          const layerId = event.dataTransfer.getData(DRAG_TYPE);
          const from = visual.findIndex((layer) => layer.id === layerId);
          if (from === -1) return;
          const gap = gapFromEvent(event);
          // Position among the other rows, then converted from top-first to bottom-first order.
          const visualIndex = gap > from ? gap - 1 : gap;
          moveLayerTo(layerId, layers.length - 1 - visualIndex);
        }}
      >
        {visual.map((layer, index) => {
          const Icon = TYPE_ICONS[layer.type];
          const count = countObjects(objects, layer.id);
          const isActive = layer.id === active?.id;
          const isExpanded = expanded.has(layer.id);
          const Chevron = isExpanded ? ChevronDown : ChevronRight;
          const VisibilityIcon = layer.visible ? Eye : EyeOff;
          const LockIcon = layer.locked ? Lock : LockOpen;
          return (
            <li
              key={layer.id}
              className="layer"
              data-layer-id={layer.id}
              data-active={isActive || undefined}
              data-hidden={!layer.visible || undefined}
              data-drop-before={dropGap === index || undefined}
              data-drop-after={(dropGap === visual.length && index === visual.length - 1) || undefined}
              draggable={renamingId !== layer.id}
              onDragStart={(event) => {
                event.dataTransfer.setData(DRAG_TYPE, layer.id);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => setDropGap(null)}
            >
              <div
                className="layer__row"
                onClick={() => setActiveLayer(layer.id)}
                onDoubleClick={() => setRenaming(layer.id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setActiveLayer(layer.id);
                  setMenu({ x: event.clientX, y: event.clientY });
                }}
              >
                <button
                  type="button"
                  className="icon-button icon-button--small"
                  aria-label={t('layers.showObjects')}
                  title={t('layers.showObjects')}
                  aria-expanded={isExpanded}
                  onClick={(event) => {
                    event.stopPropagation();
                    setExpanded((current) => {
                      const next = new Set(current);
                      if (!next.delete(layer.id)) next.add(layer.id);
                      return next;
                    });
                  }}
                >
                  <Chevron size={14} aria-hidden />
                </button>
                <span className="layer__icon" title={t(`layers.types.${layer.type}`)}>
                  <Icon size={15} aria-hidden />
                </span>
                {renamingId === layer.id ? (
                  <NameEditor layer={layer} onDone={() => setRenaming(null)} />
                ) : (
                  <button type="button" className="layer__name" aria-pressed={isActive} title={layer.name}>
                    {layer.name}
                  </button>
                )}
                <span className="layer__count" title={t('layers.objectCount')}>
                  {count}
                </span>
                <button
                  type="button"
                  className="icon-button icon-button--small"
                  aria-label={t('layers.visible')}
                  title={t('layers.visible')}
                  aria-pressed={layer.visible}
                  onClick={(event) => {
                    event.stopPropagation();
                    setLayerProperties(layer.id, { visible: !layer.visible });
                  }}
                >
                  <VisibilityIcon size={15} aria-hidden />
                </button>
                <button
                  type="button"
                  className="icon-button icon-button--small"
                  aria-label={t('layers.locked')}
                  title={t('layers.locked')}
                  aria-pressed={layer.locked}
                  onClick={(event) => {
                    event.stopPropagation();
                    setLayerProperties(layer.id, { locked: !layer.locked });
                  }}
                >
                  <LockIcon size={15} aria-hidden />
                </button>
              </div>
              {isExpanded && (
                <ul className="layer__objects">
                  {/* Top-most object first, like the layers themselves. */}
                  {objects
                    .filter((object) => object.layerId === layer.id)
                    .reverse()
                    .map((object) => (
                      <ObjectRow
                        key={object.id}
                        document={document}
                        pageId={pageId}
                        object={object}
                        selectable={selectableIds.has(object.id)}
                      />
                    ))}
                </ul>
              )}
            </li>
          );
        })}
        <li className="layer layer--fixed">
          <div className="layer__row">
            <span className="layer__spacer" />
            <span className="layer__icon">
              <FileText size={15} aria-hidden />
            </span>
            <span className="layer__name layer__name--static">{t('layers.original')}</span>
            <Lock size={14} aria-hidden className="layer__fixed-lock" />
          </div>
        </li>
      </ul>

      {layers.length === 0 && <p className="panel__empty">{t('layers.empty')}</p>}

      {active && (
        <div className="layers__footer">
          <label className="field">
            <span>{t('layers.opacity')}</span>
            <input
              className="input field__number"
              type="number"
              min={0}
              max={100}
              step={5}
              value={Math.round(active.opacity * 100)}
              onChange={(event) => {
                const percent = Number(event.target.value);
                if (event.target.value.trim() === '' || !Number.isFinite(percent)) return;
                setLayerProperties(active.id, { opacity: Math.min(100, Math.max(0, percent)) / 100 });
              }}
            />
          </label>
        </div>
      )}
      {menu && <ContextMenu label={t('menu.layers')} x={menu.x} y={menu.y} items={CONTEXT_MENU} onClose={closeMenu} />}
    </div>
  );
}
