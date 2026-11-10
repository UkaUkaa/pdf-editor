import { vi } from 'vitest';
import type { CommandId } from '@shared/menu/commands';
import type { PreloadApi } from '@shared/types/api';
import type { OpenFileResult, RecentFile, RecoveryEntry, WriteFileResult } from '@shared/types/document';
import type { SystemFontFamily } from '@shared/types/fonts';
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/types/settings';
import { mergeSettings } from '@shared/schemas/settings';
import {
  PdfLoadError,
  type PasswordPrompt,
  type PdfSource,
  type RenderRequest,
} from '@renderer/engine/pdf/types';
import { releaseDocument } from '@renderer/engine/rendering/pageRenderer';
import { setImageDecoder, setPdfLoader } from '@renderer/features/documents/documentActions';
import { resetFonts } from '@renderer/engine/fonts/fontRegistry';
import { resetAutosave } from '@renderer/features/project/autosave';
import { useRecoveryStore } from '@renderer/features/project/recovery';
import { initI18n } from '@renderer/localization/i18n';
import { useDocumentsStore } from '@renderer/stores/documentsStore';
import { initSettingsStore, resetSettingsStore } from '@renderer/stores/settingsStore';
import { setObjectImageDecoder } from '@renderer/features/pdf-editor/objectActions';
import { resetSearchStore } from '@renderer/stores/searchStore';
import { resetToolStore } from '@renderer/stores/toolStore';
import { resetUiStore } from '@renderer/stores/uiStore';

export interface FakeApi extends PreloadApi {
  /** Settings as the fake main process currently holds them. */
  current: () => AppSettings;
  emitCommand: (id: CommandId) => void;
  /** What the next "open" dialog returns. */
  dialogResults: OpenFileResult[];
  recentFiles: RecentFile[];
  /** What the next image dialog, save dialog and folder dialog return. */
  imageResults: OpenFileResult[];
  savePath: string | null;
  directory: string | null;
  /** Every PDF the application wrote, in order. */
  written: Array<{ path: string; data: Uint8Array }>;
  /** What the attach dialog returns, attachments saved to disk and links opened outside the app. */
  attachmentResults: OpenFileResult[];
  savedAttachments: Array<{ name: string; data: Uint8Array }>;
  openedUrls: string[];
  writeResult: WriteFileResult | null;
  /** Contents of the recovery folder; `leftOver` marks copies from an earlier session. */
  recoveryCopies: Map<string, RecoveryEntry & { data: Uint8Array; leftOver: boolean }>;
  /** Paths the "operating system" asked to open before start; and a way to send more later. */
  /** Fonts "installed" on the computer. */
  systemFonts: SystemFontFamily[];
  openRequests: string[];
  emitOpenRequest: (paths: string[]) => void;
}

/** A successful file read whose bytes describe the fake PDF: "<pages>", "<pages>:<password>" or "<pages>::outline". */
export function fakeFile(name: string, descriptor = '3'): OpenFileResult {
  const data = new TextEncoder().encode(descriptor);
  return { ok: true, file: { path: `/docs/${name}`, name, size: data.length, data } };
}

/** In-memory stand-in for the preload bridge, behaving like the real main process. */
export function createFakeApi(platform: string, initial: AppSettings = DEFAULT_SETTINGS): FakeApi {
  let settings = initial;
  const commandListeners = new Set<(id: CommandId) => void>();
  const api: FakeApi = {
    platform,
    dialogResults: [],
    recentFiles: [],
    imageResults: [],
    savePath: null,
    directory: null,
    written: [],
    writeResult: null,
    attachmentResults: [],
    savedAttachments: [],
    openedUrls: [],
    recoveryCopies: new Map(),
    openRequests: [],
    systemFonts: [],
    emitOpenRequest: () => undefined,
    current: () => settings,
    emitCommand: (id) => commandListeners.forEach((listener) => listener(id)),
    settings: {
      get: vi.fn(async () => settings),
      update: vi.fn(async (patch) => (settings = mergeSettings(settings, patch))),
      onChanged: vi.fn(() => () => undefined),
    },
    menu: {
      setState: vi.fn(),
      onCommand: vi.fn((listener) => {
        commandListeners.add(listener);
        return () => commandListeners.delete(listener);
      }),
    },
    documents: {
      openDialog: vi.fn(async () => api.dialogResults),
      takeOpenRequests: vi.fn(async () => api.openRequests.splice(0)),
      onOpenRequest: vi.fn((listener: (paths: string[]) => void) => {
        api.emitOpenRequest = listener;
        return () => undefined;
      }),
      openPaths: vi.fn(async (paths: string[]) => paths.map((path) => fakeFile(path.split('/').pop() ?? path))),
      getPathForFile: vi.fn((file: File) => `/dropped/${file.name}`),
      openImagesDialog: vi.fn(async () => api.imageResults),
      writeImage: vi.fn(async (directory: string, fileName: string, data: Uint8Array): Promise<WriteFileResult> => {
        if (api.writeResult) return api.writeResult;
        const path = `${directory}/${fileName}`;
        api.written.push({ path, data });
        return { ok: true, path, size: data.length };
      }),
      openAttachmentsDialog: vi.fn(async () => api.attachmentResults),
      saveAttachment: vi.fn(async (name: string, data: Uint8Array) => {
        api.savedAttachments.push({ name, data });
        return `/saved/${name}`;
      }),
      saveDialog: vi.fn(async () => api.savePath),
      writeFile: vi.fn(async (path: string, data: Uint8Array): Promise<WriteFileResult> => {
        if (api.writeResult) return api.writeResult;
        api.written.push({ path, data });
        return { ok: true, path, size: data.length };
      }),
      chooseDirectory: vi.fn(async () => api.directory),
      writeToDirectory: vi.fn(async (directory: string, fileName: string, data: Uint8Array): Promise<WriteFileResult> => {
        if (api.writeResult) return api.writeResult;
        const path = `${directory}/${fileName}`;
        api.written.push({ path, data });
        return { ok: true, path, size: data.length };
      }),
    },
    recent: {
      list: vi.fn(async () => api.recentFiles),
      add: vi.fn(async (path: string) => {
        api.recentFiles = [{ path, name: path.split('/').pop() ?? path, openedAt: 0 }, ...api.recentFiles.filter((f) => f.path !== path)];
      }),
      clear: vi.fn(async () => {
        api.recentFiles = [];
      }),
    },
    fonts: {
      list: vi.fn(async () => api.systemFonts),
      read: vi.fn(async ({ family, bold, italic }: { family: string; bold: boolean; italic: boolean }) =>
        new TextEncoder().encode(`font:${family}:${bold ? 'b' : ''}${italic ? 'i' : ''}`),
      ),
    },
    recovery: {
      list: vi.fn(async () =>
        [...api.recoveryCopies.values()].filter((copy) => copy.leftOver).map(({ id, name, path, savedAt, size }) => ({ id, name, path, savedAt, size })),
      ),
      write: vi.fn(async (entry: { id: string; name: string; path: string | null }, data: Uint8Array) => {
        api.recoveryCopies.set(entry.id, { ...entry, savedAt: 0, size: data.length, data, leftOver: false });
        return true;
      }),
      read: vi.fn(async (id: string) => api.recoveryCopies.get(id)?.data ?? null),
      remove: vi.fn(async (id: string) => {
        api.recoveryCopies.delete(id);
      }),
    },
    app: {
      getInfo: vi.fn(async () => ({
        name: 'PDF Editor',
        version: '9.9.9',
        electron: '1',
        chrome: '2',
        node: '3',
        platform,
        arch: 'x64',
        userName: 'tester',
      })),
      performRole: vi.fn(async () => undefined),
      setDirty: vi.fn(),
      openExternal: vi.fn(async (url: string) => {
        api.openedUrls.push(url);
        return true;
      }),
    },
  };
  return api;
}

export const renderRequests: RenderRequest[] = [];
export const destroyedSources: PdfSource[] = [];

/** Fake PDF engine: A4 pages, instant "rendering", optional password, "corrupt" marker. */
async function fakeLoader(data: Uint8Array, askPassword: PasswordPrompt): Promise<PdfSource> {
  const descriptor = new TextDecoder().decode(data);
  // A file written by the fake exporter of the test setup: one page per exported page.
  const exportedPages = descriptor.startsWith('%PDF-fake')
    ? (JSON.parse(descriptor.replace('%PDF-fake', '')) as { pages: unknown[] }).pages.length
    : null;
  const [pages = '1', password, flag] = exportedPages === null ? descriptor.split(':') : [String(exportedPages)];
  if (pages === 'corrupt') throw new PdfLoadError('corrupt');
  if (password) {
    let answer = await askPassword('required');
    while (answer !== password) {
      if (answer === null) throw new PdfLoadError('cancelled');
      answer = await askPassword('incorrect');
    }
  }
  const source: PdfSource = {
    pageCount: Number(pages),
    // "restricted" files are protected against changes by their owner.
    protection: password ? { password, restricted: flag === 'restricted' } : null,
    getPageInfo: async () => ({ box: { x: 0, y: 0, width: 595, height: 842 }, rotation: 0 }),
    render: (request) => {
      renderRequests.push(request);
      return { promise: Promise.resolve({ width: 10, height: 10 } as ImageBitmap), cancel: () => undefined };
    },
    getOutline: async () =>
      flag === 'outline'
        ? [
            { title: 'Chapter 1', pageIndex: 0, children: [{ title: 'Section 1.1', pageIndex: 1, children: [] }] },
            { title: 'Chapter 2', pageIndex: 2, children: [] },
          ]
        : [],
    // "annotated" files carry a comment with a reply, a web link and a page link on page 1, and one attachment.
    getAnnotations: async (pageIndex) =>
      flag === 'annotated' && pageIndex === 0
        ? [
            { kind: 'note', objectNumber: 11, x: 100, y: 50, width: 18, height: 18, text: 'Existing comment', author: 'Alice', modified: "D:20260102030405+02'00'", color: '#ff0000', inReplyTo: null },
            { kind: 'note', objectNumber: 12, x: 100, y: 50, width: 18, height: 18, text: 'I agree', author: 'Bob', modified: 'D:20260103000000Z', color: null, inReplyTo: 11 },
            { kind: 'link', objectNumber: 13, x: 10, y: 700, width: 200, height: 14, url: 'https://example.com/docs', pageIndex: null },
            { kind: 'link', objectNumber: 14, x: 10, y: 720, width: 200, height: 14, url: null, pageIndex: 1 },
          ]
        : [],
    getAttachments: async () => (flag === 'annotated' ? [{ name: 'data.csv', data: new TextEncoder().encode('a,b\n1,2\n') }] : []),
    getTextRuns: async () => [
      { text: 'Original line', x: 50, baseline: 100, angle: 0, width: 120, fontSize: 12, fontFamily: 'serif' },
      { text: 'Second line', x: 50, baseline: 130, angle: 0, width: 100, fontSize: 12, fontFamily: 'sans' },
    ],
    destroy: async () => {
      destroyedSources.push(source);
    },
  };
  return source;
}

/** jsdom reports zero-sized elements; give scroll containers a real viewport. */
export function mockViewportSize(width: number, height: number): void {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(height);
}

export async function setupApp(options: { platform?: string; settings?: AppSettings } = {}): Promise<FakeApi> {
  const api = createFakeApi(options.platform ?? 'win32', options.settings ?? DEFAULT_SETTINGS);
  window.api = api;
  for (const document of useDocumentsStore.getState().documents) await releaseDocument(document.id, document.resourceIds);
  useDocumentsStore.setState({ documents: [], activeId: null });
  renderRequests.length = 0;
  destroyedSources.length = 0;
  setPdfLoader(fakeLoader);
  const decoder: Parameters<typeof setImageDecoder>[0] = async (fileName, data) => {
    if (fileName.startsWith('bad')) throw new Error('cannot decode');
    return { bytes: data, mime: 'image/png', bitmap: { width: 400, height: 200, close: () => undefined } as ImageBitmap };
  };
  setImageDecoder(decoder);
  setObjectImageDecoder(decoder);
  resetFonts();
  resetAutosave();
  useRecoveryStore.setState({ entries: [], open: false });
  resetToolStore();
  resetSearchStore();
  resetSettingsStore();
  resetUiStore();
  const settings = await initSettingsStore(api);
  await initI18n(settings.language);
  return api;
}
