import type { CommandId } from './commands';

export type MenuNode =
  | { type: 'separator' }
  | { type: 'command'; id: CommandId; platform?: 'mac' | 'nonMac' }
  | { type: 'submenu'; id: string; items: MenuNode[] };

export interface TopLevelMenu {
  /** Translation key suffix: `menu.<id>`. */
  id: string;
  items: MenuNode[];
}

const cmd = (id: CommandId, platform?: 'mac' | 'nonMac'): MenuNode => ({ type: 'command', id, platform });
const sep: MenuNode = { type: 'separator' };

/** Single source of truth for both the native macOS menu and the in-app menu bar. */
export const MENU_MODEL: TopLevelMenu[] = [
  {
    id: 'file',
    items: [
      cmd('file.new'),
      cmd('file.open'),
      sep,
      cmd('file.save'),
      cmd('file.saveAs'),
      cmd('file.saveProject'),
      cmd('file.saveCopy'),
      cmd('file.exportPdf'),
      cmd('file.exportImages'),
      sep,
      cmd('file.print'),
      sep,
      cmd('file.close'),
      cmd('file.quit', 'nonMac'),
    ],
  },
  {
    id: 'edit',
    items: [
      cmd('edit.undo'),
      cmd('edit.redo'),
      sep,
      cmd('edit.cut'),
      cmd('edit.copy'),
      cmd('edit.paste'),
      cmd('edit.selectAll'),
      cmd('edit.duplicate'),
      cmd('edit.delete'),
      sep,
      cmd('edit.find'),
      cmd('edit.findNext'),
      cmd('edit.findPrevious'),
      cmd('edit.findReplace'),
    ],
  },
  {
    id: 'view',
    items: [
      cmd('view.toggleLeftPanel'),
      cmd('view.toggleRightPanel'),
      cmd('view.resetLayout'),
      sep,
      {
        type: 'submenu',
        id: 'theme',
        items: [cmd('view.themeLight'), cmd('view.themeDark'), cmd('view.themeSystem')],
      },
      sep,
      cmd('view.zoomIn'),
      cmd('view.zoomOut'),
      cmd('view.fitPage'),
      cmd('view.fitWidth'),
      sep,
      cmd('view.singlePage'),
      cmd('view.continuous'),
      cmd('view.twoPage'),
      sep,
      {
        type: 'submenu',
        id: 'goTo',
        items: [cmd('view.firstPage'), cmd('view.prevPage'), cmd('view.nextPage'), cmd('view.lastPage')],
      },
      sep,
      cmd('view.fullScreen'),
    ],
  },
  {
    id: 'insert',
    items: [
      cmd('insert.text'),
      cmd('insert.image'),
      {
        type: 'submenu',
        id: 'shapes',
        items: [cmd('insert.shapeRect'), cmd('insert.shapeEllipse'), cmd('insert.shapeLine'), cmd('insert.shapeArrow')],
      },
      sep,
      cmd('insert.link'),
      cmd('insert.bookmark'),
      cmd('insert.attachment'),
      sep,
      cmd('insert.watermark'),
      cmd('insert.headerFooter'),
    ],
  },
  {
    id: 'pages',
    items: [
      cmd('pages.addBlank'),
      cmd('pages.insertFromPdf'),
      cmd('pages.importImages'),
      sep,
      cmd('pages.duplicate'),
      cmd('pages.delete'),
      sep,
      cmd('pages.rotateCw'),
      cmd('pages.rotateCcw'),
      cmd('pages.moveUp'),
      cmd('pages.moveDown'),
      cmd('pages.crop'),
      cmd('pages.reverse'),
      sep,
      cmd('pages.extract'),
      cmd('pages.split'),
      cmd('pages.merge'),
    ],
  },
  {
    id: 'tools',
    items: [
      cmd('tools.select'),
      cmd('tools.hand'),
      cmd('tools.editText'),
      cmd('tools.draw'),
      cmd('tools.highlight'),
      cmd('tools.comment'),
      cmd('tools.highlightText'),
      cmd('tools.underline'),
      cmd('tools.strikethrough'),
      cmd('tools.eraser'),
      sep,
      cmd('tools.ocr'),
      cmd('tools.compress'),
      cmd('tools.protect'),
    ],
  },
  {
    id: 'arrange',
    items: [
      cmd('arrange.bringToFront'),
      cmd('arrange.bringForward'),
      cmd('arrange.sendBackward'),
      cmd('arrange.sendToBack'),
      sep,
      {
        type: 'submenu',
        id: 'align',
        items: [
          cmd('arrange.alignLeft'),
          cmd('arrange.alignCenter'),
          cmd('arrange.alignRight'),
          sep,
          cmd('arrange.alignTop'),
          cmd('arrange.alignMiddle'),
          cmd('arrange.alignBottom'),
          sep,
          cmd('arrange.distributeHorizontal'),
          cmd('arrange.distributeVertical'),
        ],
      },
      sep,
      cmd('arrange.group'),
      cmd('arrange.ungroup'),
      sep,
      cmd('arrange.lock'),
      cmd('arrange.unlock'),
    ],
  },
  {
    id: 'layers',
    items: [
      cmd('layers.new'),
      cmd('layers.duplicate'),
      cmd('layers.rename'),
      cmd('layers.delete'),
      sep,
      cmd('layers.moveUp'),
      cmd('layers.moveDown'),
      sep,
      cmd('layers.merge'),
    ],
  },
  {
    id: 'window',
    items: [cmd('window.minimize'), cmd('window.maximize')],
  },
  {
    id: 'settings',
    items: [
      cmd('settings.preferences'),
      sep,
      {
        type: 'submenu',
        id: 'language',
        items: [cmd('settings.languageEn'), cmd('settings.languageRu'), cmd('settings.languageUk')],
      },
    ],
  },
  {
    id: 'help',
    items: [cmd('help.about')],
  },
];

/** Removes platform-specific items and collapses redundant separators. */
export function filterMenuForPlatform(items: MenuNode[], isMac: boolean): MenuNode[] {
  const kept: MenuNode[] = [];
  for (const item of items) {
    if (item.type === 'command' && item.platform) {
      if ((item.platform === 'mac') !== isMac) continue;
    }
    if (item.type === 'separator' && (kept.length === 0 || kept.at(-1)?.type === 'separator')) continue;
    kept.push(item.type === 'submenu' ? { ...item, items: filterMenuForPlatform(item.items, isMac) } : item);
  }
  while (kept.at(-1)?.type === 'separator') kept.pop();
  return kept;
}

export function collectCommandIds(items: MenuNode[]): CommandId[] {
  return items.flatMap((item) =>
    item.type === 'command' ? [item.id] : item.type === 'submenu' ? collectCommandIds(item.items) : [],
  );
}
