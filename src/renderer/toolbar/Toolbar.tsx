import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Crop,
  Eraser,
  FolderOpen,
  Hand,
  Highlighter,
  Image,
  Link,
  MessageSquare,
  Moon,
  MousePointer2,
  PanelLeft,
  PanelRight,
  Pencil,
  Redo2,
  Save,
  Settings,
  Shapes,
  Sun,
  TextCursorInput,
  Type,
  Underline,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import type { CommandId } from '@shared/menu/commands';
import { CommandButton } from '../components/CommandButton';
import { ContextMenu, type ContextMenuItem } from '../components/ContextMenu';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { selectActiveDocument, useDocumentsStore } from '../stores/documentsStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useToolStore } from '../stores/toolStore';
import { ViewerControls } from './ViewerControls';

type ToolGroup = ReadonlyArray<readonly [CommandId, LucideIcon]>;

const SHAPE_COMMANDS: readonly ContextMenuItem[] = [
  'insert.shapeRect',
  'insert.shapeEllipse',
  'insert.shapeLine',
  'insert.shapeArrow',
];
const SHAPE_TOOLS: ReadonlySet<string> = new Set(['rect', 'ellipse', 'line', 'arrow']);

const MARKUP_COMMANDS: readonly ContextMenuItem[] = ['tools.highlightText', 'tools.underline', 'tools.strikethrough'];
const MARKUP_TOOLS: ReadonlySet<string> = new Set(['markText', 'underline', 'strikethrough']);

interface ToolMenuButtonProps {
  label: string;
  icon: LucideIcon;
  action: string;
  items: readonly ContextMenuItem[];
  tools: ReadonlySet<string>;
}

/** One button for a family of tools; the choice is made in a small menu below it. */
function ToolMenuButton({ label, icon: Icon, action, items, tools }: ToolMenuButtonProps): React.JSX.Element {
  const ref = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const close = useCallback(() => setMenu(null), []);
  const hasDocument = useDocumentsStore((state) => selectActiveDocument(state) !== null);
  const active = useToolStore((state) => tools.has(state.tool));

  return (
    <>
      <button
        ref={ref}
        type="button"
        className="icon-button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        aria-pressed={active && hasDocument}
        aria-disabled={!hasDocument}
        data-action={action}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (!hasDocument) return;
          const rect = ref.current?.getBoundingClientRect();
          setMenu(menu ? null : { x: rect?.left ?? 0, y: (rect?.bottom ?? 0) + 4 });
        }}
      >
        <Icon size={18} strokeWidth={1.75} aria-hidden />
      </button>
      {menu && <ContextMenu label={label} x={menu.x} y={menu.y} items={items} onClose={close} />}
    </>
  );
}

const TOOL_GROUPS: readonly ToolGroup[] = [
  [
    ['file.open', FolderOpen],
    ['file.save', Save],
  ],
  [
    ['edit.undo', Undo2],
    ['edit.redo', Redo2],
  ],
  [
    ['tools.select', MousePointer2],
    ['tools.hand', Hand],
  ],
  [
    ['tools.editText', TextCursorInput],
    ['insert.text', Type],
    ['insert.image', Image],
    ['tools.draw', Pencil],
  ],
  [
    ['tools.highlight', Highlighter],
    ['tools.eraser', Eraser],
  ],
  [
    ['tools.comment', MessageSquare],
    ['insert.link', Link],
    ['pages.crop', Crop],
  ],
];
/** The shapes button belongs at the end of this group. */
const INSERT_GROUP = 3;
/** The text-markup button belongs at the end of this group. */
const MARKUP_GROUP = 4;

export function Toolbar(): React.JSX.Element {
  const { t } = useTranslation();
  const preference = useSettingsStore((state) => state.settings.theme);
  const update = useSettingsStore((state) => state.update);
  const resolved = useResolvedTheme(preference);
  const ThemeIcon = resolved === 'dark' ? Sun : Moon;

  return (
    <div className="toolbar" role="toolbar" aria-label={t('toolbar.label')}>
      {TOOL_GROUPS.map((group, index) => (
        <div key={index} className="toolbar__group">
          {group.map(([id, icon]) => (
            <CommandButton key={id} id={id} icon={icon} />
          ))}
          {index === INSERT_GROUP && (
            <ToolMenuButton label={t('toolbar.shapes')} icon={Shapes} action="shapes" items={SHAPE_COMMANDS} tools={SHAPE_TOOLS} />
          )}
          {index === MARKUP_GROUP && (
            <ToolMenuButton label={t('toolbar.markup')} icon={Underline} action="markup" items={MARKUP_COMMANDS} tools={MARKUP_TOOLS} />
          )}
        </div>
      ))}
      <ViewerControls />
      <div className="toolbar__spacer" />
      <div className="toolbar__group">
        <CommandButton id="view.toggleLeftPanel" icon={PanelLeft} />
        <CommandButton id="view.toggleRightPanel" icon={PanelRight} />
        <button
          type="button"
          className="icon-button"
          aria-label={t('toolbar.toggleTheme')}
          title={t('toolbar.toggleTheme')}
          data-action="toggle-theme"
          onClick={() => update({ theme: resolved === 'dark' ? 'light' : 'dark' })}
        >
          <ThemeIcon size={18} strokeWidth={1.75} aria-hidden />
        </button>
        <CommandButton id="settings.preferences" icon={Settings} />
      </div>
    </div>
  );
}
