import { create } from 'zustand';
import type { UpdateState } from '@shared/types/updates';
import { useUiStore } from '../../stores/uiStore';

interface UpdatesStore {
  state: UpdateState | null;
}

export const useUpdatesStore = create<UpdatesStore>(() => ({ state: null }));

/** Versions the user has already been told about in this session. */
const announced = new Set<string>();

function receive(state: UpdateState): void {
  useUpdatesStore.setState({ state });
  // Something the user should act on is shown once, without interrupting an open dialog.
  const actionable = state.status === 'ready' || state.status === 'available';
  if (!actionable || !state.version || announced.has(`${state.status}:${state.version}`)) return;
  announced.add(`${state.status}:${state.version}`);
  if (useUiStore.getState().dialog === null) useUiStore.getState().openDialog('updates');
}

/** Follows the update state reported by the main process. Returns the unsubscribe function. */
export function watchUpdates(): () => void {
  void window.api.updates.getState().then(receive, () => undefined);
  return window.api.updates.onState(receive);
}

/** "Check for Updates…": always checks, and shows the outcome whatever it is. */
export async function checkForUpdates(): Promise<void> {
  useUiStore.getState().openDialog('updates');
  const current = useUpdatesStore.getState().state;
  if (current && current.status !== 'unavailable' && current.status !== 'ready' && current.status !== 'downloading') {
    useUpdatesStore.setState({ state: { ...current, status: 'checking' } });
  }
  const state = await window.api.updates.check().catch(() => null);
  if (state) {
    if (state.version) announced.add(`${state.status}:${state.version}`);
    useUpdatesStore.setState({ state });
  }
}

/** Test hook. */
export function resetUpdates(): void {
  announced.clear();
  useUpdatesStore.setState({ state: null });
}
