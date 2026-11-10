import { useTranslation } from 'react-i18next';
import { getCommand, type CommandId } from '@shared/menu/commands';
import { formatAccelerator } from '@shared/utils/accelerator';
import { executeCommand, isCommandChecked, isCommandEnabled, isCommandImplemented } from '../services/commands';
import { selectActiveDocument, useDocumentsStore } from '../stores/documentsStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useToolStore } from '../stores/toolStore';
import { useUiStore } from '../stores/uiStore';

export interface CommandView {
  label: string;
  /** Tooltip: the label, or an explanation of when the command will be delivered. */
  hint: string;
  shortcut: string | undefined;
  /** False for commands that are planned but not implemented yet. */
  implemented: boolean;
  /** Whether the command can run right now. */
  enabled: boolean;
  checked: boolean;
  kind: 'checkbox' | 'radio' | undefined;
  run: () => void;
}

/** Everything a menu item or toolbar button needs to render one command. */
export function useCommand(id: CommandId): CommandView {
  const { t } = useTranslation();
  const settings = useSettingsStore((state) => state.settings);
  const document = useDocumentsStore(selectActiveDocument);
  const textFieldFocused = useUiStore((state) => state.textFieldFocused);
  const tool = useToolStore((state) => state.tool);
  const canPaste = useToolStore((state) => state.clipboard.length > 0);
  const context = { settings, document, textFieldFocused, tool, canPaste };
  const definition = getCommand(id);
  const isMac = window.api.platform === 'darwin';
  const label = t(`commands.${id}`);
  const implemented = isCommandImplemented(id);
  const accelerator = isMac && id === 'view.fullScreen' ? 'Ctrl+Cmd+F' : definition.accelerator;

  return {
    label,
    hint: implemented ? label : t('common.planned', { label, phase: definition.phase }),
    shortcut: accelerator ? formatAccelerator(accelerator, isMac) : undefined,
    implemented,
    enabled: isCommandEnabled(id, context),
    checked: isCommandChecked(id, context),
    kind: definition.kind,
    run: () => void executeCommand(id),
  };
}
