import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { userInfo } from 'node:os';
import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { IPC } from '@shared/constants/ipc';
import { APP_ROLES, COMMAND_IDS, type CommandId, type CommandState } from '@shared/menu/commands';
import { translate } from '@shared/locales';
import { settingsPatchSchema } from '@shared/schemas/settings';
import {
  IMAGE_EXTENSIONS,
  MAX_PATHS_PER_REQUEST,
  PROJECT_FILE_EXTENSION,
  type OpenFileResult,
  type WriteFileResult,
} from '@shared/types/document';
import type { AppInfo } from '@shared/types/api';
import { performRole } from '../menu/appMenu';
import { safeExternalUrl } from '@shared/utils/externalUrl';
import { isTrustedSender } from '../security/hardening';
import { writeFileAtomic } from '../services/atomicFile';
import {
  isDocumentPath,
  readAttachmentFile,
  readDocumentFile,
  readImageFile,
  sanitiseFileName,
  sanitisePdfFileName,
  uniquePdfPath,
  writeDocumentFile,
  writeImageFile,
  writePdfFile,
} from '../services/pdfFiles';
import { RECOVERY_ID_PATTERN, type RecoveryStore } from '../services/recoveryStore';
import type { OpenRequestQueue } from '../services/openRequests';
import type { RecentFilesStore } from '../services/recentFiles';
import type { SettingsStore } from '../services/settingsStore';

const commandIdSchema = z.enum(COMMAND_IDS as [CommandId, ...CommandId[]]);
const commandStateSchema = z.strictObject({
  enabled: z.array(commandIdSchema).max(COMMAND_IDS.length),
  checked: z.array(commandIdSchema).max(COMMAND_IDS.length),
});
const roleSchema = z.enum(APP_ROLES);
const pathSchema = z.string().min(1).max(4096);
const pathsSchema = z.array(pathSchema).max(MAX_PATHS_PER_REQUEST);
const bytesSchema = z.instanceof(Uint8Array);
const writeFileSchema = z.strictObject({ path: pathSchema, data: bytesSchema });
const saveDialogSchema = z.strictObject({ suggestedName: z.string().max(4096), kind: z.enum(['pdf', 'project']) });
const recoveryIdSchema = z.string().regex(RECOVERY_ID_PATTERN);
const recoveryWriteSchema = z.strictObject({
  entry: z.strictObject({ id: recoveryIdSchema, name: z.string().max(300), path: pathSchema.nullable() }),
  data: bytesSchema,
});
const writeToDirectorySchema = z.strictObject({
  directory: pathSchema,
  fileName: z.string().min(1).max(255),
  data: bytesSchema,
});

export interface IpcDependencies {
  settings: SettingsStore;
  recentFiles: RecentFilesStore;
  recovery: RecoveryStore;
  openRequests: OpenRequestQueue;
  onDirtyChange: (dirty: boolean) => void;
  onCommandState: (state: CommandState) => void;
}

function assertTrusted(event: IpcMainEvent | IpcMainInvokeEvent): void {
  if (!isTrustedSender(event.senderFrame)) {
    throw new Error('IPC message rejected: untrusted sender');
  }
}

/** Registers every IPC endpoint. Each one validates its sender and its payload. */
export function registerIpc({ settings, recentFiles, recovery, openRequests, onDirtyChange, onCommandState }: IpcDependencies): void {
  // The renderer may only write where the user pointed: files it opened or chose in a
  // save dialog, and directories chosen in a folder dialog.
  const writableFiles = new Set<string>();
  const writableDirectories = new Set<string>();
  const t = (key: string): string => translate(settings.get().language, key);

  const openPaths = async (paths: string[]): Promise<OpenFileResult[]> => {
    const results: OpenFileResult[] = [];
    // Sequential on purpose: several large files must not be held in memory twice at once.
    for (const path of paths) {
      const result = await readDocumentFile(path);
      if (result.ok) writableFiles.add(result.file.path);
      results.push(result);
    }
    return results;
  };

  ipcMain.handle(IPC.documentsOpenDialog, async (event) => {
    assertTrusted(event);
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return [];
    const { canceled, filePaths } = await dialog.showOpenDialog(window, {
      title: t('dialogs.openPdf.title'),
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: t('dialogs.openPdf.allDocuments'), extensions: ['pdf', 'pdfproject'] },
        { name: t('dialogs.openPdf.filter'), extensions: ['pdf'] },
        { name: t('dialogs.saveProject.filter'), extensions: ['pdfproject'] },
      ],
    });
    return canceled ? [] : openPaths(filePaths.slice(0, MAX_PATHS_PER_REQUEST));
  });

  ipcMain.handle(IPC.documentsOpenImagesDialog, async (event) => {
    assertTrusted(event);
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return [];
    const { canceled, filePaths } = await dialog.showOpenDialog(window, {
      title: t('dialogs.openImages.title'),
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: t('dialogs.openImages.filter'), extensions: [...IMAGE_EXTENSIONS] }],
    });
    if (canceled) return [];
    const results: OpenFileResult[] = [];
    for (const path of filePaths.slice(0, MAX_PATHS_PER_REQUEST)) results.push(await readImageFile(path));
    return results;
  });

  ipcMain.handle(IPC.documentsSaveDialog, async (event, payload: unknown) => {
    assertTrusted(event);
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return null;
    const { suggestedName, kind } = saveDialogSchema.parse(payload);
    const project = kind === 'project';
    const extension = project ? PROJECT_FILE_EXTENSION : '.pdf';
    const fileName = sanitisePdfFileName(suggestedName, kind);
    // An absolute suggestion keeps its folder; a bare name opens in the last used folder.
    const defaultPath = isDocumentPath(suggestedName) ? join(dirname(suggestedName), fileName) : fileName;
    const { canceled, filePath } = await dialog.showSaveDialog(window, {
      title: t(project ? 'dialogs.saveProject.title' : 'dialogs.savePdf.title'),
      defaultPath,
      filters: [{ name: t(project ? 'dialogs.saveProject.filter' : 'dialogs.openPdf.filter'), extensions: [extension.slice(1)] }],
    });
    if (canceled || !filePath) return null;
    const path = filePath.toLowerCase().endsWith(extension) ? filePath : `${filePath}${extension}`;
    writableFiles.add(path);
    return path;
  });

  ipcMain.handle(IPC.documentsWriteFile, async (event, payload: unknown): Promise<WriteFileResult> => {
    assertTrusted(event);
    const { path, data } = writeFileSchema.parse(payload);
    if (!writableFiles.has(path)) return { ok: false, error: 'notAllowed' };
    return writeDocumentFile(path, data);
  });

  ipcMain.handle(IPC.documentsChooseDirectory, async (event) => {
    assertTrusted(event);
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return null;
    const { canceled, filePaths } = await dialog.showOpenDialog(window, {
      title: t('dialogs.chooseFolder.title'),
      properties: ['openDirectory', 'createDirectory'],
    });
    const directory = filePaths[0];
    if (canceled || !directory) return null;
    writableDirectories.add(directory);
    return directory;
  });

  ipcMain.handle(IPC.documentsWriteToDirectory, async (event, payload: unknown): Promise<WriteFileResult> => {
    assertTrusted(event);
    const { directory, fileName, data } = writeToDirectorySchema.parse(payload);
    if (!writableDirectories.has(directory)) return { ok: false, error: 'notAllowed' };
    try {
      return await writePdfFile(await uniquePdfPath(directory, fileName), data);
    } catch {
      return { ok: false, error: 'writeFailed' };
    }
  });

  ipcMain.handle(IPC.documentsWriteImage, async (event, payload: unknown): Promise<WriteFileResult> => {
    assertTrusted(event);
    const { directory, fileName, data } = writeToDirectorySchema.parse(payload);
    if (!writableDirectories.has(directory)) return { ok: false, error: 'notAllowed' };
    return writeImageFile(directory, fileName, data);
  });

  ipcMain.handle(IPC.documentsOpenAttachmentsDialog, async (event) => {
    assertTrusted(event);
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return [];
    const { canceled, filePaths } = await dialog.showOpenDialog(window, {
      title: t('dialogs.attachFiles.title'),
      properties: ['openFile', 'multiSelections'],
    });
    if (canceled) return [];
    const results: OpenFileResult[] = [];
    for (const path of filePaths.slice(0, MAX_PATHS_PER_REQUEST)) results.push(await readAttachmentFile(path));
    return results;
  });

  // Extracting an attachment: the user picks the destination in a native dialog, and
  // the bytes go only there. The file is written, never opened.
  ipcMain.handle(IPC.documentsSaveAttachment, async (event, payload: unknown) => {
    assertTrusted(event);
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return null;
    const { suggestedName, data } = z.strictObject({ suggestedName: z.string().max(1024), data: bytesSchema }).parse(payload);
    const { canceled, filePath } = await dialog.showSaveDialog(window, {
      title: t('dialogs.saveAttachment.title'),
      defaultPath: sanitiseFileName(suggestedName),
    });
    if (canceled || !filePath) return null;
    try {
      await writeFileAtomic(filePath, data);
      return filePath;
    } catch {
      return null;
    }
  });

  ipcMain.handle(IPC.appOpenExternal, async (event, payload: unknown) => {
    assertTrusted(event);
    // Validated again here: the renderer is never trusted to decide what the OS opens.
    const url = safeExternalUrl(z.string().max(2048).parse(payload));
    if (!url) return false;
    await shell.openExternal(url);
    return true;
  });

  ipcMain.on(IPC.appSetDirty, (event, payload: unknown) => {
    if (isTrustedSender(event.senderFrame)) onDirtyChange(payload === true);
  });

  ipcMain.handle(IPC.documentsOpenPaths, (event, payload: unknown) => {
    assertTrusted(event);
    return openPaths(pathsSchema.parse(payload));
  });

  ipcMain.handle(IPC.documentsTakeOpenRequests, (event) => {
    assertTrusted(event);
    return openRequests.take();
  });

  ipcMain.handle(IPC.recentList, (event) => {
    assertTrusted(event);
    return recentFiles.list();
  });

  // Called by the renderer once a document has actually been parsed, so damaged
  // files never end up in the list.
  ipcMain.handle(IPC.recentAdd, async (event, payload: unknown) => {
    assertTrusted(event);
    const path = pathSchema.parse(payload);
    if (!isDocumentPath(path)) return;
    const exists = await access(path).then(
      () => true,
      () => false,
    );
    if (!exists) return;
    await recentFiles.add(path);
    app.addRecentDocument(path);
  });

  ipcMain.handle(IPC.recentClear, async (event) => {
    assertTrusted(event);
    await recentFiles.clear();
    app.clearRecentDocuments();
  });

  ipcMain.handle(IPC.recoveryList, (event) => {
    assertTrusted(event);
    return recovery.listLeftOver();
  });

  ipcMain.handle(IPC.recoveryWrite, async (event, payload: unknown) => {
    assertTrusted(event);
    const { entry, data } = recoveryWriteSchema.parse(payload);
    return recovery.write(entry, data);
  });

  ipcMain.handle(IPC.recoveryRead, async (event, payload: unknown) => {
    assertTrusted(event);
    const id = recoveryIdSchema.parse(payload);
    const result = await recovery.read(id);
    // The restored document may be saved back to the file it belonged to.
    if (result?.entry.path && isDocumentPath(result.entry.path)) writableFiles.add(result.entry.path);
    return result?.data ?? null;
  });

  ipcMain.handle(IPC.recoveryRemove, async (event, payload: unknown) => {
    assertTrusted(event);
    await recovery.remove(recoveryIdSchema.parse(payload));
  });

  ipcMain.handle(IPC.settingsGet, (event) => {
    assertTrusted(event);
    return settings.get();
  });

  ipcMain.handle(IPC.settingsUpdate, async (event, payload: unknown) => {
    assertTrusted(event);
    return settings.update(settingsPatchSchema.parse(payload));
  });

  ipcMain.handle(IPC.appGetInfo, (event): AppInfo => {
    assertTrusted(event);
    return {
      name: app.name,
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      userName: (() => {
        try {
          return userInfo().username;
        } catch {
          return '';
        }
      })(),
    };
  });

  ipcMain.handle(IPC.appPerformRole, (event, payload: unknown) => {
    assertTrusted(event);
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) performRole(window, roleSchema.parse(payload));
  });

  ipcMain.on(IPC.menuSetState, (event, payload: unknown) => {
    try {
      assertTrusted(event);
      onCommandState(commandStateSchema.parse(payload));
    } catch (error) {
      console.warn(String(error));
    }
  });

  settings.subscribe((next) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC.settingsChanged, next);
    }
  });
}
