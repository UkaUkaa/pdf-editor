import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDown,
  ArrowUp,
  BookmarkPlus,
  BringToFront,
  ChevronDown,
  ChevronUp,
  Copy,
  FilePlus,
  Group,
  Lock,
  LockOpen,
  MessageSquarePlus,
  MoveDown,
  MoveUp,
  Paperclip,
  Plus,
  RotateCcw,
  RotateCw,
  SendToBack,
  Trash2,
  Ungroup,
  type LucideIcon,
} from 'lucide-react';
import type { CommandId } from '@shared/menu/commands';
import { useCommand } from '../hooks/useCommand';

/** Icons of commands that appear as buttons outside the main toolbar. */
const COMMAND_ICONS: Partial<Record<CommandId, LucideIcon>> = {
  'arrange.bringToFront': BringToFront,
  'arrange.bringForward': MoveUp,
  'arrange.sendBackward': MoveDown,
  'arrange.sendToBack': SendToBack,
  'arrange.alignLeft': AlignStartVertical,
  'arrange.alignCenter': AlignCenterVertical,
  'arrange.alignRight': AlignEndVertical,
  'arrange.alignTop': AlignStartHorizontal,
  'arrange.alignMiddle': AlignCenterHorizontal,
  'arrange.alignBottom': AlignEndHorizontal,
  'edit.duplicate': Copy,
  'edit.delete': Trash2,
  'pages.addBlank': FilePlus,
  'pages.rotateCcw': RotateCcw,
  'pages.rotateCw': RotateCw,
  'pages.delete': Trash2,
  'pages.moveUp': ChevronUp,
  'pages.moveDown': ChevronDown,
  'layers.new': Plus,
  'insert.bookmark': BookmarkPlus,
  'tools.comment': MessageSquarePlus,
  'insert.attachment': Paperclip,
  'layers.moveUp': ArrowUp,
  'layers.moveDown': ArrowDown,
  'layers.delete': Trash2,
  'arrange.group': Group,
  'arrange.ungroup': Ungroup,
  'arrange.lock': Lock,
  'arrange.unlock': LockOpen,
};

interface CommandButtonProps {
  id: CommandId;
  /** Defaults to the icon registered for the command. */
  icon?: LucideIcon;
  small?: boolean;
}

/** Icon button bound to a command. Disabled (with an explanation) until the command exists. */
export function CommandButton({ id, icon, small = false }: CommandButtonProps): React.JSX.Element | null {
  const command = useCommand(id);
  const Icon = icon ?? COMMAND_ICONS[id];
  if (!Icon) return null;
  const tooltip = command.shortcut && command.implemented ? `${command.hint} (${command.shortcut})` : command.hint;

  return (
    <button
      type="button"
      className={small ? 'icon-button icon-button--small' : 'icon-button'}
      aria-label={command.label}
      aria-disabled={!command.enabled}
      aria-pressed={command.kind ? command.checked : undefined}
      title={tooltip}
      data-command={id}
      // Keep the keyboard focus where it is, so edit commands still target the focused field.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        if (command.enabled) command.run();
      }}
    >
      <Icon size={small ? 16 : 18} strokeWidth={1.75} aria-hidden />
    </button>
  );
}
