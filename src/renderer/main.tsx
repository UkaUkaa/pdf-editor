import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { cssFont } from '@shared/fonts';
import { FONT_FAMILIES } from '@shared/types/objects';
import { App } from './app/App';
import { initFonts } from './engine/fonts/fontRegistry';
import { installCanvasTextMeasurer } from './engine/objects/canvasMeasurer';
import { initI18n } from './localization/i18n';
import { initSettingsStore } from './stores/settingsStore';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/app.css';

async function bootstrap(): Promise<void> {
  const settings = await initSettingsStore(window.api);
  await initI18n(settings.language);
  // Text is measured with the bundled fonts, so they must be ready before anything is laid out.
  await Promise.all(
    FONT_FAMILIES.flatMap((family) =>
      [false, true].flatMap((bold) =>
        [false, true].map((italic) => document.fonts.load(cssFont(family, 16, { bold, italic })).catch(() => undefined)),
      ),
    ),
  );
  installCanvasTextMeasurer();
  // The list of installed fonts; their files are loaded only when a document uses them.
  await initFonts();

  const container = document.getElementById('root');
  if (!container) throw new Error('Root element is missing');
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
