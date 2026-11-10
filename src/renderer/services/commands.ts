import { quickOcr } from '../features/ocr/ocrActions';
import { checkForUpdates } from '../features/updates/updates';
import { COMMAND_IDS, getCommand, type CommandId, type CommandState } from '@shared/menu/commands';
import type { DocumentModel, ViewMode } from '@shared/types/document';
import { DEFAULT_LAYOUT, type AppSettings, type Language, type ThemePreference } from '@shared/types/settings';
import {
  closeDocument,
  extractSelectedPages,
  goToPage,
  goToRelativePage,
  importImagesAsPages,
  insertPagesFromPdf,
  mergeDocuments,
  newDocument,
  openWithDialog,
  pageStep,
  saveDocument,
  saveDocumentAs,
  saveDocumentAsProject,
  saveDocumentCopy,
  exportDocumentAsPdf,
  setViewMode,
  setZoomMode,
  zoomStep,
} from '../features/documents/documentActions';
import {
  addBlankPage,
  canDeleteSelectedPages,
  canShiftSelectedPages,
  deleteSelectedPages,
  duplicateSelectedPages,
  redo,
  reverseAllPages,
  rotateSelectedPages,
  shiftSelectedPages,
  undo,
} from '../features/pages/pageActions';
import type { Tool } from '@shared/types/objects';
import { MAX_ZOOM, MIN_ZOOM } from '../engine/rendering/zoom';
import {
  activateTool,
  alignSelectedObjects,
  copySelectedObjects,
  groupSelectedObjects,
  lockSelectedObjects,
  selectedObjectsOf,
  ungroupSelectedObjects,
  unlockAllObjects,
  currentPageOf,
  cutSelectedObjects,
  deleteSelectedObjects,
  distributeSelectedObjects,
  duplicateSelectedObjects,
  insertImageWithDialog,
  objectsOnPage,
  pasteObjects,
  restackSelectedObjects,
  selectAllObjects,
} from '../features/pdf-editor/objectActions';
import {
  addLayer,
  canShiftActiveLayer,
  deleteLayer,
  duplicateActiveLayer,
  layerContext,
  mergeActiveLayerDown,
  shiftActiveLayer,
  startRenamingLayer,
} from '../features/layers/layerActions';
import { attachFiles } from '../features/attachments/AttachmentsPanel';
import { addBookmarkForCurrentPage } from '../features/bookmarks/bookmarkActions';
import { openSearch, stepHit } from '../features/search/searchActions';
import { useToolStore } from '../stores/toolStore';
import { getActiveDocument } from '../stores/documentsStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useUiStore } from '../stores/uiStore';

/** Everything a command needs to decide whether it applies right now. */
export interface CommandContext {
  settings: AppSettings;
  document: DocumentModel | null;
  /** While a text field has focus, edit commands belong to the field. */
  textFieldFocused: boolean;
  tool: Tool;
  /** Whether objects have been copied and can be pasted. */
  canPaste: boolean;
}

interface CommandHandler {
  run: () => void;
  isEnabled?: (context: CommandContext) => boolean;
  isChecked?: (context: CommandContext) => boolean;
}

const settings = (): AppSettings => useSettingsStore.getState().settings;
const update = useSettingsStore.getState().update;
const hasDocument = ({ document }: CommandContext): boolean => document !== null;

const theme = (value: ThemePreference): CommandHandler => ({
  run: () => update({ theme: value }),
  isChecked: (context) => context.settings.theme === value,
});

const language = (value: Language): CommandHandler => ({
  run: () => update({ language: value }),
  isChecked: (context) => context.settings.language === value,
});

const viewMode = (value: ViewMode): CommandHandler => ({
  run: () => setViewMode(value),
  isEnabled: hasDocument,
  isChecked: ({ document }) => document?.view.viewMode === value,
});

const lastStart = (document: DocumentModel): number => {
  const step = pageStep(document.view.viewMode);
  return Math.floor((document.pages.length - 1) / step) * step;
};

/**
 * Real implementations only. A command without an entry here (and without a
 * native role) is shown disabled everywhere in the interface.
 */
/** Undo/redo act on the focused text field if there is one, otherwise on the document. */
const history = (role: 'undo' | 'redo', act: () => void, stack: 'past' | 'future'): CommandHandler => ({
  run: () => {
    if (useUiStore.getState().textFieldFocused) void window.api.app.performRole(role);
    else act();
  },
  isEnabled: ({ document, textFieldFocused }) =>
    textFieldFocused || (document !== null && document.history[stack].length > 0),
});

const tool = (value: Tool): CommandHandler => ({
  run: () => activateTool(value),
  isEnabled: hasDocument,
  isChecked: (context) => context.document !== null && context.tool === value,
});

const hasActiveLayer = ({ document }: CommandContext): boolean => layerContext(document)?.active !== undefined;
const selectionCount = ({ document }: CommandContext): number => document?.selectedObjects.length ?? 0;
const hasSelection = (context: CommandContext): boolean => selectionCount(context) > 0;

/** Clipboard-style commands: the focused text field gets them first, otherwise they act on objects. */
const editing = (
  role: 'cut' | 'copy' | 'paste' | 'selectAll',
  act: () => void,
  isEnabled: (context: CommandContext) => boolean,
): CommandHandler => ({
  run: () => {
    if (useUiStore.getState().textFieldFocused) void window.api.app.performRole(role);
    else act();
  },
  isEnabled: (context) => context.textFieldFocused || isEnabled(context),
});

const arrange = (run: () => void, minimum = 1): CommandHandler => ({
  run,
  isEnabled: (context) => selectionCount(context) >= minimum,
});

const HANDLERS: Partial<Record<CommandId, CommandHandler>> = {
  'file.new': { run: newDocument },
  'file.exportPdf': { run: () => void exportDocumentAsPdf(), isEnabled: hasDocument },
  'file.saveProject': { run: () => void saveDocumentAsProject(), isEnabled: hasDocument },

  'edit.cut': editing('cut', cutSelectedObjects, hasSelection),
  'edit.copy': editing('copy', () => void copySelectedObjects(), hasSelection),
  'edit.paste': editing(
    'paste',
    () => {
      // Nothing of ours to paste: let the system clipboard through (an image becomes an object).
      if (!pasteObjects()) void window.api.app.performRole('paste');
    },
    hasDocument,
  ),
  'edit.selectAll': editing('selectAll', selectAllObjects, ({ document }) => {
    const page = document && currentPageOf(document);
    return Boolean(document && page && objectsOnPage(document, page.id).length > 0);
  }),
  'edit.duplicate': { run: duplicateSelectedObjects, isEnabled: hasSelection },
  'edit.find': { run: openSearch, isEnabled: hasDocument },
  'edit.findReplace': { run: openSearch, isEnabled: hasDocument },
  'tools.protect': { run: () => useUiStore.getState().openDialog('protect'), isEnabled: hasDocument },
  'tools.ocrPage': { run: () => void quickOcr('current'), isEnabled: hasDocument },
  'tools.ocrDocument': { run: () => void quickOcr('all'), isEnabled: hasDocument },
  'tools.ocr': { run: () => useUiStore.getState().openDialog('ocr'), isEnabled: hasDocument },
  'file.exportImages': { run: () => useUiStore.getState().openDialog('exportImages'), isEnabled: hasDocument },
  'edit.findNext': { run: () => stepHit(1), isEnabled: hasDocument },
  'edit.findPrevious': { run: () => stepHit(-1), isEnabled: hasDocument },
  'edit.delete': { run: deleteSelectedObjects, isEnabled: hasSelection },

  'tools.select': tool('select'),
  'tools.editText': tool('editText'),
  'tools.draw': tool('draw'),
  'tools.highlight': tool('highlight'),
  'tools.eraser': tool('eraser'),
  'tools.comment': tool('note'),
  'tools.underline': tool('underline'),
  'tools.strikethrough': tool('strikethrough'),
  'tools.highlightText': tool('markText'),
  'insert.link': tool('link'),
  'insert.attachment': { run: () => void attachFiles(), isEnabled: hasDocument },
  'insert.text': tool('text'),
  'insert.shapeRect': tool('rect'),
  'insert.shapeEllipse': tool('ellipse'),
  'insert.shapeLine': tool('line'),
  'insert.shapeArrow': tool('arrow'),
  'insert.image': { run: () => void insertImageWithDialog(), isEnabled: hasDocument },
  'insert.bookmark': { run: addBookmarkForCurrentPage, isEnabled: hasDocument },
  'insert.watermark': { run: () => useUiStore.getState().openDialog('watermark'), isEnabled: hasDocument },
  'insert.headerFooter': { run: () => useUiStore.getState().openDialog('headerFooter'), isEnabled: hasDocument },

  'arrange.bringToFront': arrange(() => restackSelectedObjects('front')),
  'arrange.bringForward': arrange(() => restackSelectedObjects('forward')),
  'arrange.sendBackward': arrange(() => restackSelectedObjects('backward')),
  'arrange.sendToBack': arrange(() => restackSelectedObjects('back')),
  'arrange.alignLeft': arrange(() => alignSelectedObjects('left')),
  'arrange.alignCenter': arrange(() => alignSelectedObjects('center')),
  'arrange.alignRight': arrange(() => alignSelectedObjects('right')),
  'arrange.alignTop': arrange(() => alignSelectedObjects('top')),
  'arrange.alignMiddle': arrange(() => alignSelectedObjects('middle')),
  'arrange.alignBottom': arrange(() => alignSelectedObjects('bottom')),
  'arrange.distributeHorizontal': arrange(() => distributeSelectedObjects('horizontal'), 3),
  'arrange.distributeVertical': arrange(() => distributeSelectedObjects('vertical'), 3),
  'arrange.group': arrange(groupSelectedObjects, 2),
  'arrange.ungroup': {
    run: ungroupSelectedObjects,
    isEnabled: ({ document }) => document !== null && selectedObjectsOf(document).some((object) => object.groupId),
  },
  'arrange.lock': arrange(lockSelectedObjects),
  'arrange.unlock': {
    run: unlockAllObjects,
    isEnabled: ({ document }) => {
      const page = document && currentPageOf(document);
      return Boolean(document && page && objectsOnPage(document, page.id).some((object) => object.locked));
    },
  },

  'layers.new': { run: addLayer, isEnabled: hasDocument },
  'layers.delete': { run: () => void deleteLayer(), isEnabled: hasActiveLayer },
  'layers.rename': { run: startRenamingLayer, isEnabled: hasActiveLayer },
  'layers.duplicate': { run: duplicateActiveLayer, isEnabled: hasActiveLayer },
  'layers.moveUp': {
    run: () => shiftActiveLayer(1),
    isEnabled: ({ document }) => canShiftActiveLayer(layerContext(document), 1),
  },
  'layers.moveDown': {
    run: () => shiftActiveLayer(-1),
    isEnabled: ({ document }) => canShiftActiveLayer(layerContext(document), -1),
  },
  // Merging goes into the layer below, so the bottom layer has nothing to merge into.
  'layers.merge': {
    run: mergeActiveLayerDown,
    isEnabled: ({ document }) => canShiftActiveLayer(layerContext(document), -1),
  },

  'file.open': { run: () => void openWithDialog() },
  'file.save': {
    run: () => void saveDocument(),
    // An unsaved new document can always be saved; a saved one only when it has changes.
    isEnabled: ({ document }) => document !== null && (document.modified || document.path === null),
  },
  'file.saveAs': { run: () => void saveDocumentAs(), isEnabled: hasDocument },
  'file.saveCopy': { run: () => void saveDocumentCopy(), isEnabled: hasDocument },

  'edit.undo': history('undo', undo, 'past'),
  'edit.redo': history('redo', redo, 'future'),

  'pages.addBlank': { run: addBlankPage, isEnabled: hasDocument },
  'pages.insertFromPdf': { run: () => void insertPagesFromPdf(), isEnabled: hasDocument },
  'pages.importImages': { run: () => void importImagesAsPages() },
  'pages.merge': { run: () => void mergeDocuments() },
  'pages.duplicate': { run: duplicateSelectedPages, isEnabled: hasDocument },
  'pages.delete': {
    run: () => void deleteSelectedPages(),
    isEnabled: ({ document }) => document !== null && canDeleteSelectedPages(document),
  },
  'pages.rotateCw': { run: () => rotateSelectedPages(90), isEnabled: hasDocument },
  'pages.rotateCcw': { run: () => rotateSelectedPages(-90), isEnabled: hasDocument },
  'pages.moveUp': {
    run: () => shiftSelectedPages(-1),
    isEnabled: ({ document }) => document !== null && canShiftSelectedPages(document, -1),
  },
  'pages.moveDown': {
    run: () => shiftSelectedPages(1),
    isEnabled: ({ document }) => document !== null && canShiftSelectedPages(document, 1),
  },
  'pages.reverse': {
    run: reverseAllPages,
    isEnabled: ({ document }) => document !== null && document.pages.length > 1,
  },
  'pages.extract': { run: () => void extractSelectedPages(), isEnabled: hasDocument },
  'pages.split': {
    run: () => useUiStore.getState().openDialog('split'),
    isEnabled: ({ document }) => document !== null && document.pages.length > 1,
  },

  'file.close': {
    run: () => {
      const document = getActiveDocument();
      if (document) void closeDocument(document.id);
    },
    isEnabled: hasDocument,
  },

  'view.toggleLeftPanel': {
    run: () => update({ layout: { leftCollapsed: !settings().layout.leftCollapsed } }),
    isChecked: (context) => !context.settings.layout.leftCollapsed,
  },
  'view.toggleRightPanel': {
    run: () => update({ layout: { rightCollapsed: !settings().layout.rightCollapsed } }),
    isChecked: (context) => !context.settings.layout.rightCollapsed,
  },
  'view.resetLayout': { run: () => update({ layout: DEFAULT_LAYOUT }) },
  'view.themeLight': theme('light'),
  'view.themeDark': theme('dark'),
  'view.themeSystem': theme('system'),

  'view.zoomIn': {
    run: () => zoomStep(1),
    isEnabled: ({ document }) => document !== null && document.view.effectiveZoom < MAX_ZOOM - 0.001,
  },
  'view.zoomOut': {
    run: () => zoomStep(-1),
    isEnabled: ({ document }) => document !== null && document.view.effectiveZoom > MIN_ZOOM + 0.001,
  },
  'view.fitPage': {
    run: () => setZoomMode('fitPage'),
    isEnabled: hasDocument,
    isChecked: ({ document }) => document?.view.zoomMode === 'fitPage',
  },
  'view.fitWidth': {
    run: () => setZoomMode('fitWidth'),
    isEnabled: hasDocument,
    isChecked: ({ document }) => document?.view.zoomMode === 'fitWidth',
  },
  'view.singlePage': viewMode('single'),
  'view.continuous': viewMode('continuous'),
  'view.twoPage': viewMode('twoPage'),

  'view.prevPage': {
    run: () => goToRelativePage(-1),
    isEnabled: ({ document }) => document !== null && document.view.currentPage >= pageStep(document.view.viewMode),
  },
  'view.nextPage': {
    run: () => goToRelativePage(1),
    isEnabled: ({ document }) => document !== null && document.view.currentPage < lastStart(document),
  },
  'view.firstPage': {
    run: () => goToPage(0),
    isEnabled: ({ document }) => document !== null && document.view.currentPage > 0,
  },
  'view.lastPage': {
    run: () => {
      const document = getActiveDocument();
      if (document) goToPage(lastStart(document));
    },
    isEnabled: ({ document }) => document !== null && document.view.currentPage < lastStart(document),
  },

  'tools.hand': tool('hand'),

  'settings.preferences': { run: () => useUiStore.getState().openDialog('settings') },
  'settings.languageEn': language('en'),
  'settings.languageRu': language('ru'),
  'settings.languageUk': language('uk'),
  'help.checkUpdates': { run: () => void checkForUpdates() },
  'help.about': { run: () => useUiStore.getState().openDialog('about') },
};

export function currentCommandContext(): CommandContext {
  return {
    settings: settings(),
    document: getActiveDocument(),
    textFieldFocused: useUiStore.getState().textFieldFocused,
    tool: useToolStore.getState().tool,
    canPaste: useToolStore.getState().clipboard.length > 0,
  };
}

/** Whether the command has a real implementation at all. */
export function isCommandImplemented(id: CommandId): boolean {
  return getCommand(id).role !== undefined || id in HANDLERS;
}

/** Whether the command can be executed in the given situation. */
export function isCommandEnabled(id: CommandId, context: CommandContext): boolean {
  if (getCommand(id).role !== undefined) return true;
  const handler = HANDLERS[id];
  return handler !== undefined && (handler.isEnabled?.(context) ?? true);
}

export function isCommandChecked(id: CommandId, context: CommandContext): boolean {
  return HANDLERS[id]?.isChecked?.(context) ?? false;
}

/** Runs the command if it is currently enabled; returns whether it ran. */
export function executeCommand(id: CommandId): boolean {
  if (!isCommandEnabled(id, currentCommandContext())) return false;
  const { role } = getCommand(id);
  if (role) void window.api.app.performRole(role);
  else HANDLERS[id]?.run();
  return true;
}

export function computeCommandState(context: CommandContext): CommandState {
  return {
    enabled: COMMAND_IDS.filter((id) => isCommandEnabled(id, context)),
    checked: COMMAND_IDS.filter((id) => isCommandChecked(id, context)),
  };
}
