import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { isBuiltInFont } from '@shared/fonts';
import { FONT_FAMILIES, type FontFamily } from '@shared/types/objects';
import { ensureFontLoaded, useFontStore } from '../engine/fonts/fontRegistry';

/** Families people look for first; they lead the list of installed fonts when present. */
const POPULAR = [
  'Times New Roman',
  'Arial',
  'Helvetica',
  'Calibri',
  'Cambria',
  'Courier New',
  'Georgia',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
  'Garamond',
  'Palatino',
  'Palatino Linotype',
  'Book Antiqua',
  'Century Gothic',
  'Segoe UI',
  'Helvetica Neue',
  'Arial Narrow',
  'Arial Black',
  'Comic Sans MS',
  'Impact',
  'Consolas',
  'Menlo',
  'Monaco',
  'Lucida Console',
];

interface FontSelectProps {
  id: string;
  value: FontFamily;
  onChange: (family: FontFamily) => void;
}

/** Font list: the bundled families, then the fonts installed on this computer. */
export function FontSelect({ id, value, onChange }: FontSelectProps): React.JSX.Element {
  const { t } = useTranslation();
  const families = useFontStore((state) => state.families);
  const { popular, others } = useMemo(() => {
    const names = families.map((family) => family.family);
    const installed = new Set(names);
    const first = POPULAR.filter((name) => installed.has(name));
    const leading = new Set(first);
    return { popular: first, others: names.filter((name) => !leading.has(name)) };
  }, [families]);
  const missing = !isBuiltInFont(value) && !families.some((family) => family.family === value);

  return (
    <select
      id={id}
      className="select"
      value={value}
      onChange={(event) => {
        const family = event.target.value;
        // The font file is loaded first, so the text is measured with the real font at once.
        void ensureFontLoaded(family).then(() => onChange(family));
      }}
    >
      {missing && <option value={value}>{t('fonts.missing', { family: value })}</option>}
      <optgroup label={t('fonts.bundled')}>
        {FONT_FAMILIES.map((family) => (
          <option key={family} value={family}>
            {t(`fonts.${family}`)}
          </option>
        ))}
      </optgroup>
      {popular.length > 0 && (
        <optgroup label={t('fonts.popular')}>
          {popular.map((family) => (
            <option key={family} value={family}>
              {family}
            </option>
          ))}
        </optgroup>
      )}
      {others.length > 0 && (
        <optgroup label={t('fonts.installed')}>
          {others.map((family) => (
            <option key={family} value={family}>
              {family}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
