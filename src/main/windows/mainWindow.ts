import { join } from 'node:path';
import { app, BrowserWindow, nativeTheme, screen } from 'electron';
import { RENDERER_URL } from '../security/hardening';
import { fitToDisplays, loadWindowState, saveWindowState, saveWindowStateSync, type WindowState } from './windowState';

export async function createMainWindow(userDataDir: string): Promise<BrowserWindow> {
  const saved = fitToDisplays(
    await loadWindowState(userDataDir),
    screen.getAllDisplays().map((display) => display.workArea),
  );

  const window = new BrowserWindow({
    x: saved.x,
    y: saved.y,
    width: saved.width,
    height: saved.height,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1d21' : '#f3f4f6',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
      // Developer tools are a development aid; the installed application does not expose them.
      devTools: !app.isPackaged,
    },
  });

  if (saved.maximized) window.maximize();
  window.once('ready-to-show', () => window.show());

  let normalBounds = window.getNormalBounds();
  let saveTimer: NodeJS.Timeout | undefined;
  const snapshot = (): WindowState => ({ ...normalBounds, maximized: window.isMaximized() });
  const scheduleSave = (): void => {
    if (!window.isMaximized() && !window.isMinimized() && !window.isFullScreen()) {
      normalBounds = window.getNormalBounds();
    }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void saveWindowState(userDataDir, snapshot()).catch(() => undefined), 400);
  };
  window.on('resize', scheduleSave);
  window.on('move', scheduleSave);
  window.on('maximize', scheduleSave);
  window.on('unmaximize', scheduleSave);
  window.on('close', () => {
    clearTimeout(saveTimer);
    // Synchronous on purpose: the process may exit right after the window closes.
    saveWindowStateSync(userDataDir, snapshot());
  });

  await window.loadURL(RENDERER_URL);
  return window;
}
