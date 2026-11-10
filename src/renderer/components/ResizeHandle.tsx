import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { PANEL_MAX_WIDTH, PANEL_MIN_WIDTH } from '@shared/types/settings';

interface ResizeHandleProps {
  /** Which panel the handle belongs to; determines the drag direction. */
  side: 'left' | 'right';
  width: number;
  defaultWidth: number;
  onResize: (width: number) => void;
  onCommit: (width: number) => void;
}

const KEYBOARD_STEP = 16;

export function clampPanelWidth(width: number): number {
  return Math.round(Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, width)));
}

/** Draggable, keyboard-accessible splitter between a side panel and the workspace. */
export function ResizeHandle({ side, width, defaultWidth, onResize, onCommit }: ResizeHandleProps): React.JSX.Element {
  const { t } = useTranslation();
  const drag = useRef<{ startX: number; startWidth: number; current: number } | null>(null);
  const direction = side === 'left' ? 1 : -1;

  return (
    <div
      className="resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={t('sidebar.resize')}
      aria-valuemin={PANEL_MIN_WIDTH}
      aria-valuemax={PANEL_MAX_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      data-side={side}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        drag.current = { startX: event.clientX, startWidth: width, current: width };
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        const next = clampPanelWidth(drag.current.startWidth + direction * (event.clientX - drag.current.startX));
        drag.current.current = next;
        onResize(next);
      }}
      onPointerUp={() => {
        if (!drag.current) return;
        const final = drag.current.current;
        drag.current = null;
        onCommit(final);
      }}
      onPointerCancel={() => {
        if (!drag.current) return;
        const original = drag.current.startWidth;
        drag.current = null;
        onCommit(original);
      }}
      onDoubleClick={() => onCommit(defaultWidth)}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const delta = (event.key === 'ArrowRight' ? 1 : -1) * direction * KEYBOARD_STEP;
        onCommit(clampPanelWidth(width + delta));
      }}
    />
  );
}
