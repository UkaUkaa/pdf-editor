import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CommandId } from '@shared/menu/commands';
import { MenuCommand } from './MenuBar';

export type ContextMenuItem = CommandId | 'separator';

interface ContextMenuProps {
  label: string;
  /** Viewport coordinates of the click that opened the menu. */
  x: number;
  y: number;
  items: readonly ContextMenuItem[];
  onClose: () => void;
}

/** Pop-up menu of commands, positioned at the pointer and kept inside the window. */
export function ContextMenu({ label, x, y, items, onClose }: ContextMenuProps): React.JSX.Element {
  const ref = useRef<HTMLUListElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    setPosition({
      left: Math.max(4, Math.min(x, window.innerWidth - width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - height - 4)),
    });
    element.querySelector<HTMLElement>('.menu__item:not([aria-disabled="true"])')?.focus();
  }, [x, y]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onPointerDown, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return (
    <ul
      ref={ref}
      className="menu menu--context"
      role="menu"
      aria-label={label}
      style={position}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
          return;
        }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        const entries = [...event.currentTarget.querySelectorAll<HTMLElement>('.menu__item')];
        const index = entries.indexOf(document.activeElement as HTMLElement);
        const step = event.key === 'ArrowDown' ? 1 : -1;
        entries[(index + step + entries.length) % entries.length]?.focus();
      }}
    >
      {items.map((item, index) =>
        item === 'separator' ? (
          <li key={`separator-${index}`} className="menu__separator" role="separator" />
        ) : (
          <MenuCommand key={item} id={item} onClose={onClose} />
        ),
      )}
    </ul>
  );
}
