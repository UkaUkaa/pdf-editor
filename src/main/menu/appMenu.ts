import { app, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { IPC } from '@shared/constants/ipc';
import { translate } from '@shared/locales';
import { getCommand, type AppRole, type CommandId, type CommandState } from '@shared/menu/commands';
import { filterMenuForPlatform, MENU_MODEL, type MenuNode } from '@shared/menu/menuModel';
import type { Language } from '@shared/types/settings';

type ElectronRole = NonNullable<MenuItemConstructorOptions['role']>;

/** Roles with a direct Electron equivalent; `toggleMaximize` is handled manually. */
const NATIVE_ROLES: Partial<Record<AppRole, ElectronRole>> = {
  undo: 'undo',
  redo: 'redo',
  cut: 'cut',
  copy: 'copy',
  paste: 'paste',
  selectAll: 'selectAll',
  minimize: 'minimize',
  toggleFullScreen: 'togglefullscreen',
  quit: 'quit',
};

export function performRole(window: BrowserWindow, role: AppRole): void {
  const contents = window.webContents;
  switch (role) {
    case 'undo':
      return contents.undo();
    case 'redo':
      return contents.redo();
    case 'cut':
      return contents.cut();
    case 'copy':
      return contents.copy();
    case 'paste':
      return contents.paste();
    case 'selectAll':
      return contents.selectAll();
    case 'minimize':
      return window.minimize();
    case 'toggleMaximize':
      return window.isMaximized() ? window.unmaximize() : window.maximize();
    case 'toggleFullScreen':
      return window.setFullScreen(!window.isFullScreen());
    case 'quit':
      return app.quit();
  }
}

export interface MenuContext {
  language: Language;
  state: CommandState;
  getWindow: () => BrowserWindow | null;
}

/**
 * macOS uses a native menu bar generated from the shared menu model.
 * Windows and Linux render the same model inside the window (renderer MenuBar),
 * so the native menu is removed there.
 */
export function applyApplicationMenu(context: MenuContext): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMacTemplate(context)));
}

export function buildMacTemplate(context: MenuContext): MenuItemConstructorOptions[] {
  const { language } = context;
  const t = (key: string, vars?: Record<string, string>): string => translate(language, key, vars);
  const name = app.name;

  const appMenu: MenuItemConstructorOptions = {
    label: name,
    submenu: [
      commandItem('help.about', context, t('menu.mac.about', { name })),
      { type: 'separator' },
      commandItem('settings.preferences', context),
      { type: 'separator' },
      { role: 'services', label: t('menu.mac.services') },
      { type: 'separator' },
      { role: 'hide', label: t('menu.mac.hide', { name }) },
      { role: 'hideOthers', label: t('menu.mac.hideOthers') },
      { role: 'unhide', label: t('menu.mac.showAll') },
      { type: 'separator' },
      { role: 'quit', label: t('menu.mac.quit', { name }) },
    ],
  };

  const menus = MENU_MODEL.map((menu): MenuItemConstructorOptions => {
    const submenu = filterMenuForPlatform(menu.items, true).map((node) => toNativeItem(node, context));
    if (menu.id === 'window') {
      submenu.push({ type: 'separator' }, { role: 'front', label: t('menu.mac.bringAllToFront') });
      return { label: t(`menu.${menu.id}`), role: 'windowMenu', submenu };
    }
    if (menu.id === 'help') return { label: t(`menu.${menu.id}`), role: 'help', submenu };
    return { label: t(`menu.${menu.id}`), submenu };
  });

  return [appMenu, ...menus];
}

function toNativeItem(node: MenuNode, context: MenuContext): MenuItemConstructorOptions {
  if (node.type === 'separator') return { type: 'separator' };
  if (node.type === 'submenu') {
    return {
      label: translate(context.language, `menu.${node.id}`),
      submenu: node.items.map((child) => toNativeItem(child, context)),
    };
  }
  return commandItem(node.id, context);
}

function commandItem(id: CommandId, context: MenuContext, labelOverride?: string): MenuItemConstructorOptions {
  const definition = getCommand(id);
  const label = labelOverride ?? translate(context.language, `commands.${id}`);
  // On macOS full screen is conventionally Ctrl+Cmd+F rather than F11.
  const accelerator = id === 'view.fullScreen' ? 'Ctrl+Cmd+F' : definition.accelerator;

  if (definition.role) {
    const nativeRole = NATIVE_ROLES[definition.role];
    if (nativeRole) return { label, role: nativeRole, accelerator };
    const role = definition.role;
    return {
      label,
      accelerator,
      click: () => {
        const window = context.getWindow();
        if (window) performRole(window, role);
      },
    };
  }

  return {
    label,
    accelerator,
    type: definition.kind ?? 'normal',
    enabled: context.state.enabled.includes(id),
    checked: definition.kind ? context.state.checked.includes(id) : undefined,
    click: () => context.getWindow()?.webContents.send(IPC.menuCommand, id),
  };
}
