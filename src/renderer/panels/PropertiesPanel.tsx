import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  FlipHorizontal2,
  FlipVertical2,
  Italic,
  PanelRightClose,
  type LucideIcon,
} from 'lucide-react';
import type { DocumentModel } from '@shared/types/document';
import type { Layer } from '@shared/types/layers';
import {
  FONT_FAMILIES,
  type EditorObject,
  type FontFamily,
  type LinkObject,
  type LinkTarget,
  type ShapeObject,
  type TextAlign,
  type TextObject,
  type ToolStyle,
} from '@shared/types/objects';
import { CommandButton } from '../components/CommandButton';
import { safeExternalUrl } from '@shared/utils/externalUrl';
import { followLink } from '../features/comments/commentActions';
import { layerContext } from '../features/layers/layerActions';
import {
  moveSelectedObjectsToLayer,
  patchSelectedObjects,
  selectedObjectsOf,
} from '../features/pdf-editor/objectActions';
import { selectActiveDocument, useDocumentsStore } from '../stores/documentsStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useToolStore } from '../stores/toolStore';

const round = (value: number): number => Math.round(value * 100) / 100;
const ALIGN_ICONS: Record<TextAlign, LucideIcon> = { left: AlignLeft, center: AlignCenter, right: AlignRight };

interface NumberFieldProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onCommit: (value: number) => void;
}

/** Numeric input that keeps what the user is typing and commits every valid value. */
function NumberField({ label, value, min, max, step = 1, onCommit }: NumberFieldProps): React.JSX.Element {
  const id = useId();
  const [text, setText] = useState(String(round(value)));
  useEffect(() => setText(String(round(value))), [value]);

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input field__number"
        type="number"
        value={text}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          setText(event.target.value);
          const parsed = Number(event.target.value);
          if (event.target.value.trim() === '' || !Number.isFinite(parsed)) return;
          onCommit(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed)));
        }}
        onBlur={() => setText(String(round(value)))}
      />
    </div>
  );
}

interface ColorFieldProps {
  label: string;
  value: string | null;
  /** When set, the colour can be switched off (e.g. "no fill"). */
  optional?: boolean;
  fallback?: string;
  onCommit: (value: string | null) => void;
}

function ColorField({
  label,
  value,
  optional = false,
  fallback = '#ffffff',
  onCommit,
}: ColorFieldProps): React.JSX.Element {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <span className="field__color">
        {optional && (
          <input
            type="checkbox"
            aria-label={label}
            checked={value !== null}
            onChange={(event) => onCommit(event.target.checked ? fallback : null)}
          />
        )}
        <input
          id={id}
          type="color"
          value={value ?? fallback}
          disabled={value === null}
          onChange={(event) => onCommit(event.target.value)}
        />
      </span>
    </div>
  );
}

function Toggle(props: { label: string; icon: LucideIcon; pressed: boolean; onToggle: () => void }): React.JSX.Element {
  const Icon = props.icon;
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={props.label}
      title={props.label}
      aria-pressed={props.pressed}
      onClick={props.onToggle}
    >
      <Icon size={16} aria-hidden />
    </button>
  );
}

/** Value shared by all objects, or the first one's when they differ. */
function shared<T extends EditorObject, K extends keyof T>(objects: readonly T[], key: K): T[K] {
  return objects[0]![key];
}

function TextSection({ objects }: { objects: TextObject[] }): React.JSX.Element {
  const { t } = useTranslation();
  const fontId = useId();
  const patch = (values: Partial<TextObject>, key: string): void => patchSelectedObjects(values, `text:${key}`);
  const align = shared(objects, 'align');

  return (
    <section className="properties__section">
      <h3 className="properties__heading">{t('properties.text')}</h3>
      {objects.some((object) => object.replacesOriginal) && (
        <p className="properties__note">{t('properties.overlayNote')}</p>
      )}
      <div className="field">
        <label htmlFor={fontId}>{t('properties.font')}</label>
        <select
          id={fontId}
          className="select"
          value={shared(objects, 'fontFamily')}
          onChange={(event) => patch({ fontFamily: event.target.value as FontFamily }, 'font')}
        >
          {FONT_FAMILIES.map((family) => (
            <option key={family} value={family}>
              {t(`fonts.${family}`)}
            </option>
          ))}
        </select>
      </div>
      <NumberField
        label={t('properties.fontSize')}
        value={shared(objects, 'fontSize')}
        min={4}
        max={400}
        onCommit={(fontSize) => patch({ fontSize }, 'size')}
      />
      <div className="field">
        <span>{t('properties.style')}</span>
        <span className="field__buttons">
          <Toggle
            label={t('properties.bold')}
            icon={Bold}
            pressed={shared(objects, 'bold')}
            onToggle={() => patch({ bold: !shared(objects, 'bold') }, 'bold')}
          />
          <Toggle
            label={t('properties.italic')}
            icon={Italic}
            pressed={shared(objects, 'italic')}
            onToggle={() => patch({ italic: !shared(objects, 'italic') }, 'italic')}
          />
          {(Object.keys(ALIGN_ICONS) as TextAlign[]).map((value) => (
            <Toggle
              key={value}
              label={t(`properties.align.${value}`)}
              icon={ALIGN_ICONS[value]}
              pressed={align === value}
              onToggle={() => patch({ align: value }, 'align')}
            />
          ))}
        </span>
      </div>
      <ColorField
        label={t('properties.color')}
        value={shared(objects, 'color')}
        onCommit={(color) => color && patch({ color }, 'color')}
      />
      <NumberField
        label={t('properties.lineHeight')}
        value={shared(objects, 'lineHeight')}
        min={0.8}
        max={3}
        step={0.1}
        onCommit={(lineHeight) => patch({ lineHeight }, 'lineHeight')}
      />
      <ColorField
        label={t('properties.background')}
        value={shared(objects, 'background')}
        optional
        onCommit={(background) => patch({ background }, 'background')}
      />
    </section>
  );
}

function StrokeSection({ objects }: { objects: EditorObject[] }): React.JSX.Element | null {
  const { t } = useTranslation();
  const stroked = objects.filter((object) => object.type === 'shape' || object.type === 'path');
  const first = stroked[0];
  if (!first) return null;
  const shapes = objects.filter((object): object is ShapeObject => object.type === 'shape');
  const closed = shapes.filter((shape) => shape.shape === 'rect' || shape.shape === 'ellipse');

  return (
    <section className="properties__section">
      <h3 className="properties__heading">{t('properties.appearance')}</h3>
      <ColorField
        label={t('properties.stroke')}
        value={first.stroke}
        // A closed shape may have no outline; lines and freehand strokes always need one.
        optional={closed.length === stroked.length}
        fallback="#d92d20"
        onCommit={(stroke) => patchSelectedObjects({ stroke }, 'shape:stroke')}
      />
      <NumberField
        label={t('properties.strokeWidth')}
        value={first.strokeWidth}
        min={0.25}
        max={100}
        step={0.5}
        onCommit={(strokeWidth) => patchSelectedObjects({ strokeWidth }, 'shape:width')}
      />
      {closed[0] && (
        <ColorField
          label={t('properties.fill')}
          value={closed[0].fill}
          optional
          fallback="#ffe14d"
          onCommit={(fill) => patchSelectedObjects({ fill }, 'shape:fill')}
        />
      )}
      {shapes[0] && (
        <label className="checkbox">
          <input
            type="checkbox"
            checked={shapes[0].dashed}
            onChange={(event) => patchSelectedObjects({ dashed: event.target.checked }, 'shape:dashed')}
          />
          <span>{t('properties.dashed')}</span>
        </label>
      )}
    </section>
  );
}

function LinkSection({ link, document }: { link: LinkObject; document: DocumentModel }): React.JSX.Element {
  const { t } = useTranslation();
  const urlId = useId();
  const pageId = useId();
  const kindName = useId();
  const [url, setUrl] = useState(link.target.kind === 'url' ? link.target.url : '');
  const currentUrl = link.target.kind === 'url' ? link.target.url : '';
  useEffect(() => setUrl(currentUrl), [currentUrl]);
  const invalid = url.trim() !== '' && safeExternalUrl(url) === null;
  const pageNumber =
    link.target.kind === 'page'
      ? document.pages.findIndex((page) => page.id === (link.target as { pageId: string }).pageId) + 1
      : 0;
  const setTarget = (target: LinkTarget): void => patchSelectedObjects({ target }, 'link:target');

  return (
    <section className="properties__section">
      <h3 className="properties__heading">{t('links.title')}</h3>
      <div className="segmented">
        {(['url', 'page'] as const).map((kind) => (
          <label key={kind} className="segmented__option">
            <input
              type="radio"
              name={kindName}
              checked={link.target.kind === kind}
              onChange={() =>
                setTarget(
                  kind === 'url'
                    ? { kind: 'url', url: '' }
                    : { kind: 'page', pageId: document.pages[document.view.currentPage]!.id },
                )
              }
            />
            <span>{t(`links.kinds.${kind}`)}</span>
          </label>
        ))}
      </div>
      {link.target.kind === 'url' ? (
        <>
          <div className="field field--stacked">
            <label htmlFor={urlId}>{t('links.address')}</label>
            <input
              id={urlId}
              className="input"
              type="url"
              placeholder="https://"
              value={url}
              aria-invalid={invalid}
              onChange={(event) => setUrl(event.target.value)}
              onBlur={() => {
                // Only web and mail addresses are accepted; anything else is not stored.
                const safe = safeExternalUrl(url);
                if (safe) setTarget({ kind: 'url', url: safe });
                else if (url.trim() === '') setTarget({ kind: 'url', url: '' });
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
            />
          </div>
          {invalid && (
            <p className="form-error" role="alert">
              {t('links.invalid')}
            </p>
          )}
        </>
      ) : (
        <div className="field">
          <label htmlFor={pageId}>{t('links.page')}</label>
          <input
            id={pageId}
            className="input field__number"
            type="number"
            min={1}
            max={document.pages.length}
            value={pageNumber || ''}
            onChange={(event) => {
              const target = document.pages[Number(event.target.value) - 1];
              if (target) setTarget({ kind: 'page', pageId: target.id });
            }}
          />
        </div>
      )}
      <button
        type="button"
        className="button"
        disabled={link.target.kind === 'url' ? safeExternalUrl(link.target.url) === null : pageNumber === 0}
        onClick={() => void followLink(link)}
      >
        {t('links.follow')}
      </button>
    </section>
  );
}

function ObjectProperties({ objects, layers }: { objects: EditorObject[]; layers: Layer[] }): React.JSX.Element {
  const { t } = useTranslation();
  const layerId = useId();
  const sameLayer = objects.every((object) => object.layerId === objects[0]!.layerId);
  const single = objects.length === 1 ? objects[0] : undefined;
  const texts = objects.filter((object): object is TextObject => object.type === 'text');
  const images = objects.filter((object) => object.type === 'image');
  const activeDocument = useDocumentsStore(selectActiveDocument);
  const geometry = (values: Partial<EditorObject>, key: string): void =>
    patchSelectedObjects(values, `geometry:${key}`);

  return (
    <>
      <p className="properties__summary" data-testid="selection-summary">
        {single ? t(`properties.types.${single.type}`) : t('properties.multiple', { count: objects.length })}
      </p>

      {single && (
        <section className="properties__section">
          <h3 className="properties__heading">{t('properties.geometry')}</h3>
          <div className="properties__grid">
            <NumberField label="X" value={single.x} onCommit={(x) => geometry({ x }, 'x')} />
            <NumberField label="Y" value={single.y} onCommit={(y) => geometry({ y }, 'y')} />
            {single.type !== 'note' && (
              <NumberField
                label={t('properties.width')}
                value={single.width}
                min={1}
                onCommit={(width) => geometry({ width }, 'w')}
              />
            )}
            {single.type !== 'text' && single.type !== 'note' && (
              <NumberField
                label={t('properties.height')}
                value={single.height}
                min={0}
                onCommit={(height) => geometry({ height }, 'h')}
              />
            )}
            {single.type !== 'note' && single.type !== 'link' && (
              <NumberField
                label={t('properties.rotation')}
                value={single.rotation}
                min={-360}
                max={360}
                onCommit={(rotation) => geometry({ rotation: ((rotation % 360) + 360) % 360 }, 'r')}
              />
            )}
          </div>
        </section>
      )}

      <section className="properties__section">
        <div className="field">
          <label htmlFor={layerId}>{t('properties.layer')}</label>
          <select
            id={layerId}
            className="select"
            value={sameLayer ? objects[0]!.layerId : ''}
            onChange={(event) => {
              if (event.target.value) moveSelectedObjectsToLayer(event.target.value);
            }}
          >
            {!sameLayer && <option value="">{t('common.none')}</option>}
            {/* Top-most layer first, as in the layers panel. */}
            {[...layers].reverse().map((layer) => (
              <option key={layer.id} value={layer.id} disabled={layer.locked || !layer.visible}>
                {layer.name}
              </option>
            ))}
          </select>
        </div>
        <NumberField
          label={t('properties.opacity')}
          value={Math.round(shared(objects, 'opacity') * 100)}
          min={0}
          max={100}
          step={5}
          onCommit={(percent) => patchSelectedObjects({ opacity: percent / 100 }, 'opacity')}
        />
      </section>

      {texts.length > 0 && <TextSection objects={texts} />}
      {single?.type === 'link' && activeDocument && (
        <LinkSection key={single.id} link={single} document={activeDocument} />
      )}
      {single?.type === 'note' && <p className="properties__note">{t('comments.editInPanel')}</p>}
      <StrokeSection objects={objects} />

      {images.length > 0 && images.length === objects.length && (
        <section className="properties__section">
          <h3 className="properties__heading">{t('properties.image')}</h3>
          <span className="field__buttons">
            <Toggle
              label={t('properties.flipHorizontal')}
              icon={FlipHorizontal2}
              pressed={images[0]!.type === 'image' && images[0]!.flipX}
              onToggle={() =>
                patchSelectedObjects({ flipX: !(images[0]!.type === 'image' && images[0]!.flipX) }, 'flipX')
              }
            />
            <Toggle
              label={t('properties.flipVertical')}
              icon={FlipVertical2}
              pressed={images[0]!.type === 'image' && images[0]!.flipY}
              onToggle={() =>
                patchSelectedObjects({ flipY: !(images[0]!.type === 'image' && images[0]!.flipY) }, 'flipY')
              }
            />
          </span>
        </section>
      )}

      <section className="properties__section">
        <h3 className="properties__heading">{t('menu.arrange')}</h3>
        <div className="properties__commands">
          <CommandButton id="arrange.bringToFront" small />
          <CommandButton id="arrange.bringForward" small />
          <CommandButton id="arrange.sendBackward" small />
          <CommandButton id="arrange.sendToBack" small />
        </div>
        <div className="properties__commands">
          <CommandButton id="arrange.alignLeft" small />
          <CommandButton id="arrange.alignCenter" small />
          <CommandButton id="arrange.alignRight" small />
          <CommandButton id="arrange.alignTop" small />
          <CommandButton id="arrange.alignMiddle" small />
          <CommandButton id="arrange.alignBottom" small />
        </div>
        <div className="properties__commands">
          <CommandButton id="arrange.group" small />
          <CommandButton id="arrange.ungroup" small />
          <CommandButton id="arrange.lock" small />
          <CommandButton id="edit.duplicate" small />
          <CommandButton id="edit.delete" small />
        </div>
      </section>
    </>
  );
}

/** Style of the objects the active tool is about to create. */
function ToolDefaults(): React.JSX.Element | null {
  const { t } = useTranslation();
  const tool = useToolStore((state) => state.tool);
  const style = useToolStore((state) => state.style);
  const setStyle = useToolStore((state) => state.setStyle);
  const fontId = useId();
  const set = <K extends keyof ToolStyle>(key: K, value: ToolStyle[K]): void =>
    setStyle({ [key]: value } as Pick<ToolStyle, K>);

  const isText = tool === 'text';
  const isHighlight = tool === 'highlight';
  const isStroke = tool === 'draw' || tool === 'line' || tool === 'arrow' || tool === 'rect' || tool === 'ellipse';
  if (!isText && !isHighlight && !isStroke) return null;

  return (
    <section className="properties__section">
      <h3 className="properties__heading">{t('properties.toolDefaults', { tool: t(`tools.${tool}`) })}</h3>
      {isText && (
        <>
          <div className="field">
            <label htmlFor={fontId}>{t('properties.font')}</label>
            <select
              id={fontId}
              className="select"
              value={style.fontFamily}
              onChange={(event) => set('fontFamily', event.target.value as FontFamily)}
            >
              {FONT_FAMILIES.map((family) => (
                <option key={family} value={family}>
                  {t(`fonts.${family}`)}
                </option>
              ))}
            </select>
          </div>
          <NumberField
            label={t('properties.fontSize')}
            value={style.fontSize}
            min={4}
            max={400}
            onCommit={(value) => set('fontSize', value)}
          />
          <ColorField
            label={t('properties.color')}
            value={style.textColor}
            onCommit={(value) => value && set('textColor', value)}
          />
        </>
      )}
      {isHighlight && (
        <ColorField
          label={t('properties.color')}
          value={style.highlightColor}
          onCommit={(value) => value && set('highlightColor', value)}
        />
      )}
      {isStroke && (
        <>
          <ColorField
            label={t('properties.stroke')}
            value={style.stroke}
            onCommit={(value) => value && set('stroke', value)}
          />
          <NumberField
            label={t('properties.strokeWidth')}
            value={style.strokeWidth}
            min={0.25}
            max={100}
            step={0.5}
            onCommit={(value) => set('strokeWidth', value)}
          />
          {(tool === 'rect' || tool === 'ellipse') && (
            <ColorField
              label={t('properties.fill')}
              value={style.fill}
              optional
              fallback="#ffe14d"
              onCommit={(value) => set('fill', value)}
            />
          )}
        </>
      )}
    </section>
  );
}

interface PropertiesPanelProps {
  width: number;
}

/** Contextual properties: of the selected objects, or of the tool that is about to create one. */
export function PropertiesPanel({ width }: PropertiesPanelProps): React.JSX.Element {
  const { t } = useTranslation();
  const update = useSettingsStore((state) => state.update);
  const document = useDocumentsStore(selectActiveDocument);
  const tool = useToolStore((state) => state.tool);
  const selected = document ? selectedObjectsOf(document) : [];
  const showsDefaults =
    document !== null && selected.length === 0 && !['select', 'hand', 'eraser', 'editText'].includes(tool);

  return (
    <aside className="properties panel" aria-label={t('properties.label')} style={{ width }}>
      <header className="panel__header">
        <h2 className="panel__title">{t('properties.title')}</h2>
        <button
          type="button"
          className="icon-button icon-button--small"
          aria-label={t('sidebar.collapse')}
          title={t('sidebar.collapse')}
          onClick={() => update({ layout: { rightCollapsed: true } })}
        >
          <PanelRightClose size={16} strokeWidth={1.75} aria-hidden />
        </button>
      </header>
      <div className="properties__body">
        {selected.length > 0 ? (
          <ObjectProperties objects={selected} layers={layerContext(document)?.layers ?? []} />
        ) : showsDefaults ? (
          <ToolDefaults />
        ) : (
          <p className="panel__empty">
            {document && tool === 'editText' ? t('properties.editTextHint') : t('properties.empty')}
          </p>
        )}
      </div>
    </aside>
  );
}
