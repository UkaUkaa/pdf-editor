import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppInfo } from '@shared/types/api';
import { Modal } from '../components/Modal';

interface AboutDialogProps {
  onClose: () => void;
}

export function AboutDialog({ onClose }: AboutDialogProps): React.JSX.Element {
  const { t } = useTranslation();
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    let active = true;
    void window.api.app.getInfo().then((value) => {
      if (active) setInfo(value);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <Modal title={t('about.title')} onClose={onClose}>
      <p className="about__name">{t('app.name')}</p>
      <p className="about__description">{t('app.description')}</p>
      {info && (
        <dl className="about__details">
          <dt>{t('about.version')}</dt>
          <dd>{info.version}</dd>
          <dt>{t('about.platform')}</dt>
          <dd>
            {info.platform} {info.arch}
          </dd>
          <dt>Electron</dt>
          <dd>{info.electron}</dd>
          <dt>Chromium</dt>
          <dd>{info.chrome}</dd>
          <dt>Node.js</dt>
          <dd>{info.node}</dd>
        </dl>
      )}
    </Modal>
  );
}
