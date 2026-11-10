import { useEffect, useRef } from 'react';
import { COMMAND_IDS, getCommand, isCommandId, type AppRole } from '@shared/menu/commands';
import { matchesAccelerator } from '@shared/utils/accelerator';
import { computeCommandState, executeCommand } from '../services/commands';
import { selectActiveDocument, useDocumentsStore } from '../stores/documentsStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useToolStore } from '../stores/toolStore';
import { useUiStore } from '../stores/uiStore';

/** Text-editing shortcuts are handled natively by Chromium inside inputs. */
const NATIVE_EDIT_ROLES: ReadonlySet<AppRole> = new Set(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']);

/**
 * Connects the command system to the outside world:
 *  - executes commands chosen in the native (macOS) menu,
 *  - publishes enabled/checked state so the native menu stays in sync,
 *  - handles keyboard shortcuts where there is no native menu (Windows, Linux).
 */
export function useCommandBindings(isMac: boolean): void {
  const settings = useSettingsStore((state) => state.settings);
  const document = useDocumentsStore(selectActiveDocument);
  const textFieldFocused = useUiStore((state) => state.textFieldFocused);
  const tool = useToolStore((state) => state.tool);
  const canPaste = useToolStore((state) => state.clipboard.length > 0);
  const lastPublished = useRef('');

  useEffect(
    () =>
      window.api.menu.onCommand((id) => {
        if (isCommandId(id)) executeCommand(id);
      }),
    [],
  );

  useEffect(() => {
    const state = computeCommandState({ settings, document, textFieldFocused, tool, canPaste });
    // Scrolling changes the document state many times a second; only real changes are sent.
    const serialised = JSON.stringify(state);
    if (serialised === lastPublished.current) return;
    lastPublished.current = serialised;
    window.api.menu.setState(state);
  }, [settings, document, textFieldFocused, tool, canPaste]);

  // Lets the main process warn before the window closes with unsaved changes.
  const dirty = useDocumentsStore((state) => state.documents.some((candidate) => candidate.modified));
  useEffect(() => {
    window.api.app.setDirty(dirty);
  }, [dirty]);

  // Edit commands follow the keyboard focus: text fields keep their own undo history.
  useEffect(() => {
    const isTextField = (target: EventTarget | null): boolean =>
      target instanceof HTMLElement &&
      target.matches('input:not([type=checkbox]):not([type=radio]):not([type=button]), textarea, [contenteditable="true"]');
    const onFocusIn = (event: FocusEvent): void => useUiStore.getState().setTextFieldFocused(isTextField(event.target));
    const onFocusOut = (): void => useUiStore.getState().setTextFieldFocused(false);
    window.addEventListener('focusin', onFocusIn);
    window.addEventListener('focusout', onFocusOut);
    return () => {
      window.removeEventListener('focusin', onFocusIn);
      window.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  useEffect(() => {
    if (isMac) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      for (const id of COMMAND_IDS) {
        const { accelerator, role } = getCommand(id);
        if (!accelerator || (role && NATIVE_EDIT_ROLES.has(role))) continue;
        if (!matchesAccelerator(event, accelerator, false)) continue;
        event.preventDefault();
        executeCommand(id);
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isMac]);
}
