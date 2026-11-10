import type { AppRole, CommandId, CommandState } from '../menu/commands';
import type { DocumentFileKind, OpenFileResult, RecentFile, RecoveryEntry, WriteFileResult } from './document';
import type { FontFaceRequest, SystemFontFamily } from './fonts';
import type { AppSettings, AppSettingsPatch } from './settings';

export interface AppInfo {
  name: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  arch: string;
  /** Login name of the operating-system user, used as the default comment author. */
  userName: string;
}

export type Unsubscribe = () => void;

/** The complete API surface exposed to the renderer through the preload script. */
export interface PreloadApi {
  platform: string;
  settings: {
    get(): Promise<AppSettings>;
    update(patch: AppSettingsPatch): Promise<AppSettings>;
    onChanged(listener: (settings: AppSettings) => void): Unsubscribe;
  };
  menu: {
    setState(state: CommandState): void;
    onCommand(listener: (id: CommandId) => void): Unsubscribe;
  };
  documents: {
    /** Shows the native open dialog; resolves with an empty list when cancelled. */
    openDialog(): Promise<OpenFileResult[]>;
    openPaths(paths: string[]): Promise<OpenFileResult[]>;
    /** Files the operating system asked to open before the window was ready (double click, "Open with"). */
    takeOpenRequests(): Promise<string[]>;
    /** Files the operating system asks to open while the application is running. */
    onOpenRequest(listener: (paths: string[]) => void): Unsubscribe;
    /** Lets the user pick images to import as pages. */
    openImagesDialog(): Promise<OpenFileResult[]>;
    /** Shows the native save dialog; resolves with the chosen path or `null`. */
    saveDialog(suggestedName: string, kind?: DocumentFileKind): Promise<string | null>;
    /** Writes a PDF or a project to a path the user opened or chose in a save dialog. */
    writeFile(path: string, data: Uint8Array): Promise<WriteFileResult>;
    chooseDirectory(): Promise<string | null>;
    /** Writes a PDF into a directory the user chose, never overwriting existing files. */
    writeToDirectory(directory: string, fileName: string, data: Uint8Array): Promise<WriteFileResult>;
    /** Writes a PNG or JPEG page image into a directory the user chose, never overwriting. */
    writeImage(directory: string, fileName: string, data: Uint8Array): Promise<WriteFileResult>;
    /** Lets the user pick any files to attach to the document. */
    openAttachmentsDialog(): Promise<OpenFileResult[]>;
    /** Saves arbitrary bytes (an extracted attachment) to a path the user picks. Resolves with that path, or `null`. */
    saveAttachment(suggestedName: string, data: Uint8Array): Promise<string | null>;
    /** Absolute path of a dropped `File`, or an empty string when it has none. */
    getPathForFile(file: File): string;
  };
  recent: {
    list(): Promise<RecentFile[]>;
    /** Records a document that was opened successfully. */
    add(path: string): Promise<void>;
    clear(): Promise<void>;
  };
  /** Fonts installed on the computer. Only fonts that permit embedding are offered. */
  fonts: {
    list(): Promise<SystemFontFamily[]>;
    /** Font file of one style of a listed family, or `null` when the family does not have that style. */
    read(request: FontFaceRequest): Promise<Uint8Array | null>;
  };
  /** Copies of documents with unsaved changes, kept for recovery after a crash. */
  recovery: {
    /** Documents left over from an earlier session that did not end cleanly. */
    list(): Promise<RecoveryEntry[]>;
    write(entry: { id: string; name: string; path: string | null }, data: Uint8Array): Promise<boolean>;
    read(id: string): Promise<Uint8Array | null>;
    remove(id: string): Promise<void>;
  };
  app: {
    getInfo(): Promise<AppInfo>;
    performRole(role: AppRole): Promise<void>;
    /** Tells the main process whether closing the window would lose changes. */
    setDirty(dirty: boolean): void;
    /** Opens a web or mail address in the default application. Other schemes are refused. */
    openExternal(url: string): Promise<boolean>;
  };
}
