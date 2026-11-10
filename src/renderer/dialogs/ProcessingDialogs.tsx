import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { OCR_LANGUAGES, type OcrLanguage } from '@shared/types/settings';
import { Modal } from '../components/Modal';
import { exportImages, IMAGE_RESOLUTIONS, type ImageFormat } from '../features/export/imageExport';
import { cancelOcr, runOcr, useOcrStore } from '../features/ocr/ocrActions';
import type { StampScope } from '../features/stamps/stampActions';
import { useSettingsStore } from '../stores/settingsStore';

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

/** Text recognition for scanned pages: languages, page range, progress and cancellation. */
export function OcrDialog({ onClose }: DialogProps): React.JSX.Element {
  const { t } = useTranslation();
  const languages = useSettingsStore((state) => state.settings.ocrLanguages);
  const update = useSettingsStore((state) => state.update);
  const { running, done, total, pageProgress } = useOcrStore();
  const [scope, setScope] = useState<StampScope>('all');
  const [skip, setSkip] = useState(true);

  const toggle = (language: OcrLanguage, on: boolean): void => {
    const next = OCR_LANGUAGES.filter((code) => (code === language ? on : languages.includes(code)));
    // At least one language has to stay selected.
    if (next.length > 0) update({ ocrLanguages: next });
  };
  const percent = total > 0 ? Math.round(((done + pageProgress) / total) * 100) : 0;

  return (
    // While recognition runs the dialog can only be left by cancelling it.
    <Modal title={t('ocr.title')} onClose={running ? cancelOcr : onClose}>
      {running ? (
        <div className="form-section">
          <p role="status">{t('ocr.progress', { done: Math.min(done + 1, total), total })}</p>
          <progress className="progress" max={100} value={percent} aria-label={t('ocr.title')} />
          <div className="form-actions">
            <button type="button" className="button" onClick={cancelOcr}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <form
          className="form-section"
          onSubmit={(event) => {
            event.preventDefault();
            void runOcr({ languages, scope, skipPagesWithText: skip }).then(onClose);
          }}
        >
          <fieldset className="form-row form-row--fieldset">
            <legend>{t('ocr.languages')}</legend>
            <span className="field__buttons">
              {OCR_LANGUAGES.map((language) => (
                <label key={language} className="checkbox">
                  <input type="checkbox" checked={languages.includes(language)} onChange={(event) => toggle(language, event.target.checked)} />
                  <span>{t(`ocr.language.${language}`)}</span>
                </label>
              ))}
            </span>
          </fieldset>
          <ScopeField value={scope} onChange={setScope} />
          <label className="checkbox">
            <input type="checkbox" checked={skip} onChange={(event) => setSkip(event.target.checked)} />
            <span>{t('ocr.skipText')}</span>
          </label>
          <p className="form-hint">{t('ocr.hint')}</p>
          <div className="form-actions">
            <button type="button" className="button" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="button button--primary">
              {t('ocr.start')}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/** Saves pages as PNG or JPEG images. */
export function ExportImagesDialog({ onClose }: DialogProps): React.JSX.Element {
  const { t } = useTranslation();
  const [format, setFormat] = useState<ImageFormat>('png');
  const [dpi, setDpi] = useState<number>(150);
  const [quality, setQuality] = useState('85');
  const [scope, setScope] = useState<StampScope>('all');
  const formatName = useId();
  const dpiId = useId();
  const qualityId = useId();

  return (
    <Modal title={t('exportImages.title')} onClose={onClose}>
      <form
        className="form-section"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = Number(quality);
          onClose();
          void exportImages({ format, dpi, quality: Number.isFinite(parsed) ? Math.min(100, Math.max(10, parsed)) / 100 : 0.85, scope });
        }}
      >
        <fieldset className="form-row form-row--fieldset">
          <legend>{t('exportImages.format')}</legend>
          <div className="segmented">
            {(['png', 'jpeg'] as const).map((value) => (
              <label key={value} className="segmented__option">
                <input type="radio" name={formatName} checked={format === value} onChange={() => setFormat(value)} />
                <span>{value === 'png' ? 'PNG' : 'JPEG'}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="form-row">
          <label htmlFor={dpiId}>{t('exportImages.resolution')}</label>
          <select id={dpiId} className="select" value={dpi} onChange={(event) => setDpi(Number(event.target.value))}>
            {IMAGE_RESOLUTIONS.map((value) => (
              <option key={value} value={value}>
                {t('exportImages.dpi', { value })}
              </option>
            ))}
          </select>
        </div>
        {format === 'jpeg' && (
          <div className="form-row">
            <label htmlFor={qualityId}>{t('exportImages.quality')}</label>
            <input id={qualityId} className="input form-row__number" type="number" min={10} max={100} value={quality} onChange={(event) => setQuality(event.target.value)} />
          </div>
        )}
        <ScopeField value={scope} onChange={setScope} />
        <div className="form-actions">
          <button type="button" className="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="button button--primary">
            {t('exportImages.run')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
