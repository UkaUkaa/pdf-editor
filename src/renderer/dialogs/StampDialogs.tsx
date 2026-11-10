import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TEXT_ALIGNMENTS, type TextAlign } from '@shared/types/objects';
import { Modal } from '../components/Modal';
import { addHeaderFooter, addWatermark, type StampScope } from '../features/stamps/stampActions';

interface DialogProps {
  onClose: () => void;
}

function ScopeField({ value, onChange }: { value: StampScope; onChange: (scope: StampScope) => void }): React.JSX.Element {
  const { t } = useTranslation();
  const name = useId();
  return (
    <fieldset className="form-row form-row--fieldset">
      <legend>{t('stamps.scope')}</legend>
      <div className="segmented">
        {(['all', 'selection'] as const).map((scope) => (
          <label key={scope} className="segmented__option">
            <input type="radio" name={name} checked={value === scope} onChange={() => onChange(scope)} />
            <span>{t(`stamps.scopes.${scope}`)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Actions({ onClose, disabled }: { onClose: () => void; disabled: boolean }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="form-actions">
      <button type="button" className="button" onClick={onClose}>
        {t('common.cancel')}
      </button>
      <button type="submit" className="button button--primary" disabled={disabled}>
        {t('stamps.apply')}
      </button>
    </div>
  );
}

const toNumber = (value: string, fallback: number, min: number, max: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && value.trim() !== '' ? Math.min(max, Math.max(min, parsed)) : fallback;
};

/** Adds a text watermark to pages. The result is ordinary objects on a "Watermark" layer. */
export function WatermarkDialog({ onClose }: DialogProps): React.JSX.Element {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [fontSize, setFontSize] = useState('64');
  const [color, setColor] = useState('#d92d20');
  const [opacity, setOpacity] = useState('25');
  const [angle, setAngle] = useState('-45');
  const [scope, setScope] = useState<StampScope>('all');
  const ids = { text: useId(), size: useId(), color: useId(), opacity: useId(), angle: useId() };

  return (
    <Modal title={t('stamps.watermarkTitle')} onClose={onClose}>
      <form
        className="form-section"
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim() === '') return;
          addWatermark({
            text,
            fontSize: toNumber(fontSize, 64, 6, 400),
            color,
            opacity: toNumber(opacity, 25, 1, 100) / 100,
            angle: toNumber(angle, -45, -180, 180),
            scope,
          });
          onClose();
        }}
      >
        <div className="form-row">
          <label htmlFor={ids.text}>{t('stamps.text')}</label>
          <input id={ids.text} className="input form-row__wide" autoFocus value={text} onChange={(event) => setText(event.target.value)} />
        </div>
        <div className="form-row">
          <label htmlFor={ids.size}>{t('properties.fontSize')}</label>
          <input id={ids.size} className="input form-row__number" type="number" min={6} max={400} value={fontSize} onChange={(event) => setFontSize(event.target.value)} />
        </div>
        <div className="form-row">
          <label htmlFor={ids.color}>{t('properties.color')}</label>
          <input id={ids.color} type="color" value={color} onChange={(event) => setColor(event.target.value)} />
        </div>
        <div className="form-row">
          <label htmlFor={ids.opacity}>{t('properties.opacity')}</label>
          <input id={ids.opacity} className="input form-row__number" type="number" min={1} max={100} value={opacity} onChange={(event) => setOpacity(event.target.value)} />
        </div>
        <div className="form-row">
          <label htmlFor={ids.angle}>{t('stamps.angle')}</label>
          <input id={ids.angle} className="input form-row__number" type="number" min={-180} max={180} value={angle} onChange={(event) => setAngle(event.target.value)} />
        </div>
        <ScopeField value={scope} onChange={setScope} />
        <Actions onClose={onClose} disabled={text.trim() === ''} />
      </form>
    </Modal>
  );
}

/** Adds header and footer lines, with page numbers, to pages. */
export function HeaderFooterDialog({ onClose }: DialogProps): React.JSX.Element {
  const { t } = useTranslation();
  const [header, setHeader] = useState('');
  const [footer, setFooter] = useState('{page} / {pages}');
  const [align, setAlign] = useState<TextAlign>('center');
  const [fontSize, setFontSize] = useState('10');
  const [margin, setMargin] = useState('28');
  const [scope, setScope] = useState<StampScope>('all');
  const ids = { header: useId(), footer: useId(), size: useId(), margin: useId(), align: useId() };
  const empty = header.trim() === '' && footer.trim() === '';

  return (
    <Modal title={t('stamps.headerFooterTitle')} onClose={onClose}>
      <form
        className="form-section"
        onSubmit={(event) => {
          event.preventDefault();
          if (empty) return;
          addHeaderFooter({
            header,
            footer,
            align,
            fontSize: toNumber(fontSize, 10, 4, 72),
            margin: toNumber(margin, 28, 0, 200),
            scope,
          });
          onClose();
        }}
      >
        <div className="form-row">
          <label htmlFor={ids.header}>{t('stamps.header')}</label>
          <input id={ids.header} className="input form-row__wide" autoFocus value={header} onChange={(event) => setHeader(event.target.value)} />
        </div>
        <div className="form-row">
          <label htmlFor={ids.footer}>{t('stamps.footer')}</label>
          <input id={ids.footer} className="input form-row__wide" value={footer} onChange={(event) => setFooter(event.target.value)} />
        </div>
        <p className="form-hint">{t('stamps.placeholders')}</p>
        <fieldset className="form-row form-row--fieldset">
          <legend>{t('stamps.alignment')}</legend>
          <div className="segmented">
            {TEXT_ALIGNMENTS.map((value) => (
              <label key={value} className="segmented__option">
                <input type="radio" name={ids.align} checked={align === value} onChange={() => setAlign(value)} />
                <span>{t(`stamps.alignments.${value}`)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="form-row">
          <label htmlFor={ids.size}>{t('properties.fontSize')}</label>
          <input id={ids.size} className="input form-row__number" type="number" min={4} max={72} value={fontSize} onChange={(event) => setFontSize(event.target.value)} />
        </div>
        <div className="form-row">
          <label htmlFor={ids.margin}>{t('stamps.margin')}</label>
          <input id={ids.margin} className="input form-row__number" type="number" min={0} max={200} value={margin} onChange={(event) => setMargin(event.target.value)} />
        </div>
        <ScopeField value={scope} onChange={setScope} />
        <Actions onClose={onClose} disabled={empty} />
      </form>
    </Modal>
  );
}
