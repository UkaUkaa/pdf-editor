/**
 * Catalogue of every user-facing command.
 *
 * `phase` is the roadmap phase in which the command is delivered. A command is
 * only enabled in the UI when the renderer has registered a real handler for it
 * (see renderer/services/commands.ts); everything else is rendered disabled and
 * labelled as planned, so no control ever pretends to work.
 */
export const APP_ROLES = [
  'undo',
  'redo',
  'cut',
  'copy',
  'paste',
  'selectAll',
  'minimize',
  'toggleMaximize',
  'toggleFullScreen',
  'quit',
] as const;
export type AppRole = (typeof APP_ROLES)[number];

export interface CommandDefinition {
  phase: number;
  /** Electron-style accelerator, e.g. `CmdOrCtrl+Shift+S`. */
  accelerator?: string;
  /** Commands backed by a native window/edit role are executed by the main process. */
  role?: AppRole;
  kind?: 'checkbox' | 'radio';
}

const def = <T extends Record<string, CommandDefinition>>(commands: T): T => commands;

export const COMMANDS = def({
  'file.new': { phase: 3, accelerator: 'CmdOrCtrl+N' },
  'file.open': { phase: 2, accelerator: 'CmdOrCtrl+O' },
  'file.save': { phase: 3, accelerator: 'CmdOrCtrl+S' },
  'file.saveAs': { phase: 3, accelerator: 'CmdOrCtrl+Shift+S' },
  'file.saveProject': { phase: 7 },
  'file.saveCopy': { phase: 3 },
  'file.exportPdf': { phase: 4 },
  'file.exportImages': { phase: 6 },
  'file.print': { phase: 6, accelerator: 'CmdOrCtrl+P' },
  'file.close': { phase: 2, accelerator: 'CmdOrCtrl+W' },
  'file.quit': { phase: 1, role: 'quit', accelerator: 'CmdOrCtrl+Q' },

  // Undo/redo act on the document, or on a text field while one has focus.
  'edit.undo': { phase: 3, accelerator: 'CmdOrCtrl+Z' },
  'edit.redo': { phase: 3, accelerator: 'CmdOrCtrl+Shift+Z' },
  // Clipboard commands act on objects, or on a text field while one has focus.
  'edit.cut': { phase: 4, accelerator: 'CmdOrCtrl+X' },
  'edit.copy': { phase: 4, accelerator: 'CmdOrCtrl+C' },
  'edit.paste': { phase: 4, accelerator: 'CmdOrCtrl+V' },
  'edit.selectAll': { phase: 4, accelerator: 'CmdOrCtrl+A' },
  'edit.duplicate': { phase: 4, accelerator: 'CmdOrCtrl+D' },
  'edit.delete': { phase: 4 },
  'edit.find': { phase: 6, accelerator: 'CmdOrCtrl+F' },
  'edit.findNext': { phase: 6, accelerator: 'F3' },
  'edit.findPrevious': { phase: 6, accelerator: 'Shift+F3' },
  'edit.findReplace': { phase: 6, accelerator: 'CmdOrCtrl+Shift+F' },

  'view.toggleLeftPanel': { phase: 1, kind: 'checkbox', accelerator: 'CmdOrCtrl+Alt+1' },
  'view.toggleRightPanel': { phase: 1, kind: 'checkbox', accelerator: 'CmdOrCtrl+Alt+2' },
  'view.resetLayout': { phase: 1 },
  'view.themeLight': { phase: 1, kind: 'radio' },
  'view.themeDark': { phase: 1, kind: 'radio' },
  'view.themeSystem': { phase: 1, kind: 'radio' },
  'view.zoomIn': { phase: 2, accelerator: 'CmdOrCtrl+Plus' },
  'view.zoomOut': { phase: 2, accelerator: 'CmdOrCtrl+-' },
  'view.fitPage': { phase: 2, kind: 'radio', accelerator: 'CmdOrCtrl+0' },
  'view.fitWidth': { phase: 2, kind: 'radio', accelerator: 'CmdOrCtrl+2' },
  'view.singlePage': { phase: 2, kind: 'radio' },
  'view.continuous': { phase: 2, kind: 'radio' },
  'view.twoPage': { phase: 2, kind: 'radio' },
  'view.prevPage': { phase: 2 },
  'view.nextPage': { phase: 2 },
  'view.firstPage': { phase: 2 },
  'view.lastPage': { phase: 2 },
  'view.fullScreen': { phase: 1, role: 'toggleFullScreen', accelerator: 'F11' },

  'insert.text': { phase: 4, kind: 'checkbox' },
  'insert.image': { phase: 4 },
  'insert.shapeRect': { phase: 4, kind: 'checkbox' },
  'insert.shapeEllipse': { phase: 4, kind: 'checkbox' },
  'insert.shapeLine': { phase: 4, kind: 'checkbox' },
  'insert.shapeArrow': { phase: 4, kind: 'checkbox' },
  'insert.link': { phase: 6, kind: 'checkbox', accelerator: 'CmdOrCtrl+K' },
  'insert.watermark': { phase: 6 },
  'insert.headerFooter': { phase: 6 },
  'insert.bookmark': { phase: 6, accelerator: 'CmdOrCtrl+B' },
  'insert.attachment': { phase: 6 },

  'pages.addBlank': { phase: 3 },
  'pages.insertFromPdf': { phase: 3 },
  'pages.delete': { phase: 3 },
  'pages.duplicate': { phase: 3 },
  'pages.rotateCw': { phase: 3, accelerator: 'CmdOrCtrl+R' },
  'pages.rotateCcw': { phase: 3, accelerator: 'CmdOrCtrl+Shift+R' },
  'pages.moveUp': { phase: 3 },
  'pages.moveDown': { phase: 3 },
  'pages.extract': { phase: 3 },
  'pages.split': { phase: 3 },
  'pages.merge': { phase: 3 },
  'pages.crop': { phase: 6 },
  'pages.importImages': { phase: 3 },
  'pages.reverse': { phase: 3 },

  'tools.select': { phase: 4, kind: 'checkbox' },
  'tools.hand': { phase: 2, kind: 'checkbox' },
  'tools.editText': { phase: 4, kind: 'checkbox' },
  'tools.draw': { phase: 4, kind: 'checkbox' },
  'tools.highlight': { phase: 4, kind: 'checkbox' },
  'tools.comment': { phase: 6, kind: 'checkbox' },
  'tools.underline': { phase: 6, kind: 'checkbox' },
  'tools.strikethrough': { phase: 6, kind: 'checkbox' },
  'tools.highlightText': { phase: 6, kind: 'checkbox' },
  'tools.eraser': { phase: 4, kind: 'checkbox' },
  'tools.ocr': { phase: 6 },
  'tools.compress': { phase: 6 },
  'tools.protect': { phase: 8 },

  'arrange.bringToFront': { phase: 4 },
  'arrange.bringForward': { phase: 4 },
  'arrange.sendBackward': { phase: 4 },
  'arrange.sendToBack': { phase: 4 },
  'arrange.alignLeft': { phase: 4 },
  'arrange.alignCenter': { phase: 4 },
  'arrange.alignRight': { phase: 4 },
  'arrange.alignTop': { phase: 4 },
  'arrange.alignMiddle': { phase: 4 },
  'arrange.alignBottom': { phase: 4 },
  'arrange.distributeHorizontal': { phase: 4 },
  'arrange.distributeVertical': { phase: 4 },
  'arrange.group': { phase: 5, accelerator: 'CmdOrCtrl+G' },
  'arrange.ungroup': { phase: 5, accelerator: 'CmdOrCtrl+Shift+G' },
  'arrange.lock': { phase: 5 },
  'arrange.unlock': { phase: 5 },

  'layers.new': { phase: 5 },
  'layers.delete': { phase: 5 },
  'layers.rename': { phase: 5 },
  'layers.duplicate': { phase: 5 },
  'layers.moveUp': { phase: 5 },
  'layers.moveDown': { phase: 5 },
  'layers.merge': { phase: 5 },

  'window.minimize': { phase: 1, role: 'minimize' },
  'window.maximize': { phase: 1, role: 'toggleMaximize' },

  'settings.preferences': { phase: 1, accelerator: 'CmdOrCtrl+,' },
  'settings.languageEn': { phase: 1, kind: 'radio' },
  'settings.languageRu': { phase: 1, kind: 'radio' },
  'settings.languageUk': { phase: 1, kind: 'radio' },

  'help.checkUpdates': { phase: 8 },
  'help.about': { phase: 1 },
});

export type CommandId = keyof typeof COMMANDS;

export const COMMAND_IDS = Object.keys(COMMANDS) as CommandId[];

export function getCommand(id: CommandId): CommandDefinition {
  return COMMANDS[id];
}

export function isCommandId(value: unknown): value is CommandId {
  return typeof value === 'string' && Object.hasOwn(COMMANDS, value);
}

/** State the renderer publishes so native menus mirror the in-app command state. */
export interface CommandState {
  enabled: CommandId[];
  checked: CommandId[];
}
