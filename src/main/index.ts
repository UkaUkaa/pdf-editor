import { join } from 'node:path';
import { app, BrowserWindow, dialog, nativeTheme } from 'electron';
import { resolveSystemLanguage, translate } from '@shared/locales';
import type { CommandState } from '@shared/menu/commands';
import { registerIpc } from './ipc/registerIpc';
import { applyApplicationMenu } from './menu/appMenu';
import { installAppProtocol, installSessionHardening, registerAppScheme } from './security/hardening';
import { IPC } from '@shared/constants/ipc';
import { documentPathsFromArgv, OpenRequestQueue } from './services/openRequests';
import { RecentFilesStore } from './services/recentFiles';
import { RecoveryStore } from './services/recoveryStore';
import { SettingsStore } from './services/settingsStore';
import { createMainWindow } from './windows/mainWindow';

// Lets automated tests run against an isolated profile directory.
// The installed application ignores the variable, so its data cannot be redirected from outside.
const userDataOverride = app.isPackaged ? undefined : process.env['PDF_EDITOR_USER_DATA'];
if (userDataOverride) app.setPath('userData', userDataOverride);

app.setName('PDF Editor');
registerAppScheme();

let mainWindow: BrowserWindow | null = null;
let commandState: CommandState = { enabled: [], checked: [] };
/** True while any open document has unsaved changes (reported by the renderer). */
let hasUnsavedChanges = false;
let settingsFlushed = false;

// Files to open may arrive before anything is ready (macOS sends `open-file` very early).
const openRequests = new OpenRequestQueue();
/** Opens a window when there is none; available once the application has started. */
let ensureWindow: (() => void) | null = null;
app.on('open-file', (event, path) => {
  event.preventDefault();
  openRequests.add([path]);
  // On macOS the application may be running without a window.
  ensureWindow?.();
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv, workingDirectory) => {
    // A second launch hands its files to the running application.
    if (app.isPackaged) openRequests.add(documentPathsFromArgv(argv, workingDirectory));
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  void bootstrap();
}

async function bootstrap(): Promise<void> {
  await app.whenReady();
  const userDataDir = app.getPath('userData');

  const settings = new SettingsStore({
    directory: userDataDir,
    detectLanguage: () => resolveSystemLanguage([...app.getPreferredSystemLanguages(), app.getLocale()]),
    onWarning: (message) => console.warn(message),
  });
  const initial = await settings.load();
  nativeTheme.themeSource = initial.theme;

  const recentFiles = new RecentFilesStore(userDataDir, (message) => console.warn(message));
  await recentFiles.load();

  const recovery = new RecoveryStore(join(userDataDir, 'recovery'), (message) => console.warn(message));
  await recovery.prepare();

  const refreshMenu = (): void =>
    applyApplicationMenu({
      language: settings.get().language,
      state: commandState,
      getWindow: () => mainWindow,
    });

  installSessionHardening();
  installAppProtocol(join(import.meta.dirname, '../renderer'));
  registerIpc({
    settings,
    recentFiles,
    recovery,
    openRequests,
    onDirtyChange: (dirty) => {
      hasUnsavedChanges = dirty;
      mainWindow?.setDocumentEdited(dirty);
    },
    onCommandState: (state) => {
      commandState = state;
      refreshMenu();
    },
  });
  settings.subscribe((next) => {
    nativeTheme.themeSource = next.theme;
    refreshMenu();
  });
  refreshMenu();

  const openWindow = async (): Promise<void> => {
    hasUnsavedChanges = false;
    mainWindow = await createMainWindow(userDataDir);
    const window = mainWindow;
    openRequests.connect((paths) => {
      if (window.isDestroyed()) return;
      window.webContents.send(IPC.documentsOpenRequested, paths);
      if (window.isMinimized()) window.restore();
      window.focus();
    });
    let closeConfirmed = false;
    mainWindow.on('close', (event) => {
      // Never silently discard user data: closing with unsaved changes needs an explicit decision.
      if (!hasUnsavedChanges || closeConfirmed || !mainWindow) return;
      const language = settings.get().language;
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: 'warning',
        message: translate(language, 'dialogs.unsavedQuit.message'),
        detail: translate(language, 'dialogs.unsavedQuit.detail'),
        buttons: [translate(language, 'dialogs.unsavedQuit.discard'), translate(language, 'common.cancel')],
        defaultId: 1,
        cancelId: 1,
      });
      if (choice === 0) {
        closeConfirmed = true;
      } else {
        event.preventDefault();
        // The quit was cancelled; settings must be flushed again on the next attempt.
        settingsFlushed = false;
      }
    });
    mainWindow.on('closed', () => {
      mainWindow = null;
      openRequests.disconnect();
      // The window closed in an orderly way (changes saved or knowingly discarded),
      // so the copies written for this session are no longer needed.
      void recovery.removeSession();
    });
  };

  ensureWindow = () => {
    if (BrowserWindow.getAllWindows().length === 0) void openWindow();
  };
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void openWindow();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // A termination signal goes through the same orderly exit as the Quit command. Without
  // these handlers Electron starts the exit itself and then does not finish it once the
  // first attempt has been deferred by the flush below.
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
    process.on(signal, () => app.quit());
  }

  app.on('before-quit', (event) => {
    if (settingsFlushed) return;
    // Make sure the last settings write reaches the disk before the process exits.
    event.preventDefault();
    void Promise.allSettled([settings.flush(), recovery.removeSession()]).finally(() => {
      settingsFlushed = true;
      app.quit();
    });
  });

  // Unpackaged runs get the script path and tool flags on the command line, not documents.
  if (app.isPackaged) openRequests.add(documentPathsFromArgv(process.argv, process.cwd()));
  await openWindow();
}
