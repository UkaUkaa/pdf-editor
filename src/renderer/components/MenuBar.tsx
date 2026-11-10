import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronRight } from 'lucide-react';
import type { CommandId } from '@shared/menu/commands';
import { filterMenuForPlatform, MENU_MODEL, type MenuNode } from '@shared/menu/menuModel';
import { useCommand } from '../hooks/useCommand';

/**
 * In-window menu bar used on Windows and Linux. macOS shows the same menu
 * model in the native system menu bar instead (see main/menu/appMenu.ts).
 */
export function MenuBar(): React.JSX.Element {
  const { t } = useTranslation();
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const menus = useMemo(
    () => MENU_MODEL.map((menu) => ({ ...menu, items: filterMenuForPlatform(menu.items, false) })),
    [],
  );
  const close = (): void => setOpenIndex(null);

  useEffect(() => {
    if (openIndex === null) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpenIndex(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('blur', close);
    };
  }, [openIndex]);

  const focusTopLevel = (index: number): void => {
    rootRef.current?.querySelectorAll<HTMLElement>('.menubar__trigger')[index]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const count = menus.length;
    if (event.key === 'Escape' && openIndex !== null) {
      event.preventDefault();
      focusTopLevel(openIndex);
      close();
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const triggers = [...(rootRef.current?.querySelectorAll<HTMLElement>('.menubar__trigger') ?? [])];
      const focused = triggers.indexOf(document.activeElement as HTMLElement);
      const current = openIndex ?? focused;
      if (current < 0) return;
      // Inside a submenu the arrows belong to the submenu itself.
      if ((event.target as HTMLElement).closest('.menu--sub')) return;
      event.preventDefault();
      const next = (current + (event.key === 'ArrowRight' ? 1 : -1) + count) % count;
      if (openIndex !== null) setOpenIndex(next);
      focusTopLevel(next);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const target = event.target as HTMLElement;
      const list = target.closest('[role="menu"]') ?? target.parentElement?.querySelector('[role="menu"]');
      if (!list) return;
      event.preventDefault();
      const items = [...list.querySelectorAll<HTMLElement>(':scope > li > .menu__item')];
      const index = items.indexOf(document.activeElement as HTMLElement);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    }
  };

  return (
    <nav ref={rootRef} className="menubar" role="menubar" aria-label={t('menu.mainMenu')} onKeyDown={onKeyDown}>
      {menus.map((menu, index) => (
        <div key={menu.id} className="menubar__entry">
          <button
            type="button"
            role="menuitem"
            className="menubar__trigger"
            aria-haspopup="menu"
            aria-expanded={openIndex === index}
            data-open={openIndex === index || undefined}
            onClick={() => setOpenIndex(openIndex === index ? null : index)}
            onMouseEnter={() => {
              if (openIndex !== null) setOpenIndex(index);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' && openIndex !== index) setOpenIndex(index);
            }}
          >
            {t(`menu.${menu.id}`)}
          </button>
          {openIndex === index && <MenuList items={menu.items} label={t(`menu.${menu.id}`)} onClose={close} />}
        </div>
      ))}
    </nav>
  );
}

interface MenuListProps {
  items: MenuNode[];
  label: string;
  onClose: () => void;
  nested?: boolean;
}

function MenuList({ items, label, onClose, nested = false }: MenuListProps): React.JSX.Element {
  const { t } = useTranslation();
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);

  return (
    <ul className={nested ? 'menu menu--sub' : 'menu'} role="menu" aria-label={label}>
      {items.map((item, index) => {
        if (item.type === 'separator') {
          return <li key={`separator-${index}`} className="menu__separator" role="separator" />;
        }
        if (item.type === 'submenu') {
          const submenuLabel = t(`menu.${item.id}`);
          const isOpen = openSubmenu === item.id;
          return (
            <li
              key={item.id}
              role="none"
              className="menu__entry"
              onMouseEnter={() => setOpenSubmenu(item.id)}
            >
              <button
                type="button"
                role="menuitem"
                className="menu__item"
                aria-haspopup="menu"
                aria-expanded={isOpen}
                onMouseDown={(event) => event.preventDefault()}
                // Hover already opens the submenu, so a click must never toggle it shut.
                onClick={() => setOpenSubmenu(item.id)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowRight') {
                    event.stopPropagation();
                    setOpenSubmenu(item.id);
                  }
                  if (event.key === 'ArrowLeft' && isOpen) {
                    event.stopPropagation();
                    setOpenSubmenu(null);
                  }
                }}
              >
                <span className="menu__check" />
                <span className="menu__label">{submenuLabel}</span>
                <ChevronRight className="menu__chevron" size={14} aria-hidden />
              </button>
              {isOpen && <MenuList items={item.items} label={submenuLabel} onClose={onClose} nested />}
            </li>
          );
        }
        // Hovering a sibling item closes any open submenu, as in native menus.
        return <MenuCommand key={item.id} id={item.id} onClose={onClose} onHover={() => setOpenSubmenu(null)} />;
      })}
    </ul>
  );
}

interface MenuCommandProps {
  id: CommandId;
  onClose: () => void;
  onHover?: () => void;
}

/** One command inside a menu; also used by context menus. */
export function MenuCommand({ id, onClose, onHover }: MenuCommandProps): React.JSX.Element {
  const command = useCommand(id);
  const role = command.kind === 'checkbox' ? 'menuitemcheckbox' : command.kind === 'radio' ? 'menuitemradio' : 'menuitem';

  return (
    <li role="none" className="menu__entry" onMouseEnter={onHover}>
      <button
        type="button"
        role={role}
        className="menu__item"
        aria-checked={command.kind ? command.checked : undefined}
        aria-disabled={!command.enabled}
        title={command.implemented ? undefined : command.hint}
        // Keep focus in the document so edit commands act on the focused field.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (!command.enabled) return;
          onClose();
          command.run();
        }}
      >
        <span className="menu__check">{command.checked && <Check size={14} aria-hidden />}</span>
        <span className="menu__label">{command.label}</span>
        {command.shortcut && <span className="menu__shortcut">{command.shortcut}</span>}
      </button>
    </li>
  );
}
