import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { IPC } from '@shared/constants/ipc';
import type { AppRole, CommandId, CommandState } from '@shared/menu/commands';
import type { PreloadApi } from '@shared/types/api';
import type { DocumentFileKind, OpenFileResult, RecentFile, RecoveryEntry, WriteFileResult } from '@shared/types/document';
import type { AppSettings, AppSettingsPatch } from '@shared/types/settings';

/**
 * The only bridge between the sandboxed renderer and the main process.
 * No generic `send`/`invoke` is exposed: each method maps to one fixed channel.
 */
function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: PreloadApi = {
  platform: process.platform,
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet) as Promise<AppSettings>,
    update: (patch: AppSettingsPatch) => ipcRenderer.invoke(IPC.settingsUpdate, patch) as Promise<AppSettings>,
    onChanged: (listener) => subscribe<AppSettings>(IPC.settingsChanged, listener),
  },
  menu: {
    setState: (state: CommandState) => ipcRenderer.send(IPC.menuSetState, state),
    onCommand: (listener) => subscribe<CommandId>(IPC.menuCommand, listener),
  },
  documents: {
    openDialog: () => ipcRenderer.invoke(IPC.documentsOpenDialog) as Promise<OpenFileResult[]>,
    openPaths: (paths: string[]) => ipcRenderer.invoke(IPC.documentsOpenPaths, paths) as Promise<OpenFileResult[]>,
    takeOpenRequests: () => ipcRenderer.invoke(IPC.documentsTakeOpenRequests) as Promise<string[]>,
    onOpenRequest: (listener) => subscribe<string[]>(IPC.documentsOpenRequested, listener),
    openImagesDialog: () => ipcRenderer.invoke(IPC.documentsOpenImagesDialog) as Promise<OpenFileResult[]>,
    saveDialog: (suggestedName: string, kind: DocumentFileKind = 'pdf') =>
      ipcRenderer.invoke(IPC.documentsSaveDialog, { suggestedName, kind }) as Promise<string | null>,
    writeFile: (path: string, data: Uint8Array) =>
      ipcRenderer.invoke(IPC.documentsWriteFile, { path, data }) as Promise<WriteFileResult>,
    chooseDirectory: () => ipcRenderer.invoke(IPC.documentsChooseDirectory) as Promise<string | null>,
    writeToDirectory: (directory: string, fileName: string, data: Uint8Array) =>
      ipcRenderer.invoke(IPC.documentsWriteToDirectory, { directory, fileName, data }) as Promise<WriteFileResult>,
    writeImage: (directory: string, fileName: string, data: Uint8Array) =>
      ipcRenderer.invoke(IPC.documentsWriteImage, { directory, fileName, data }) as Promise<WriteFileResult>,
    openAttachmentsDialog: () => ipcRenderer.invoke(IPC.documentsOpenAttachmentsDialog) as Promise<OpenFileResult[]>,
    saveAttachment: (suggestedName: string, data: Uint8Array) =>
      ipcRenderer.invoke(IPC.documentsSaveAttachment, { suggestedName, data }) as Promise<string | null>,
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
  },
  recent: {
    list: () => ipcRenderer.invoke(IPC.recentList) as Promise<RecentFile[]>,
    add: (path: string) => ipcRenderer.invoke(IPC.recentAdd, path) as Promise<void>,
    clear: () => ipcRenderer.invoke(IPC.recentClear) as Promise<void>,
  },
  recovery: {
    list: () => ipcRenderer.invoke(IPC.recoveryList) as Promise<RecoveryEntry[]>,
    write: (entry, data: Uint8Array) => ipcRenderer.invoke(IPC.recoveryWrite, { entry, data }) as Promise<boolean>,
    read: (id: string) => ipcRenderer.invoke(IPC.recoveryRead, id) as Promise<Uint8Array | null>,
    remove: (id: string) => ipcRenderer.invoke(IPC.recoveryRemove, id) as Promise<void>,
  },
  app: {
    getInfo: () => ipcRenderer.invoke(IPC.appGetInfo),
    performRole: (role: AppRole) => ipcRenderer.invoke(IPC.appPerformRole, role) as Promise<void>,
    setDirty: (dirty: boolean) => ipcRenderer.send(IPC.appSetDirty, dirty),
    openExternal: (url: string) => ipcRenderer.invoke(IPC.appOpenExternal, url) as Promise<boolean>,
  },
};

contextBridge.exposeInMainWorld('api', api);
